const helper = require('./helper')
const validator = require('./validator')
const db = require('./alivedb')
const config = require('./config')
const Express = require('express')
const bodyParser = require('body-parser')
const app = Express()

db.init()

// parse application/json
app.use(bodyParser.json())

// Create AliveDB user account
app.post('/createUser',(req,res) => {
    let id = req.body.id || helper.randomId(16)
    let key = req.body.key
    let idValidate = validator.aliveDbId(id)
    let keyValidate = validator.aliveDbKey(key)

    if (keyValidate !== null)
        return res.status(400).send({error: keyValidate})

    if (idValidate !== null)
        return res.status(400).send({error: idValidate})

    db.createUser(id,key,(e,pub) => {
        if (e)
            return res.status(500).send({error: e})
        res.send({id: id, pub: pub})
    })
})

// User login
// Use id or public key
app.post('/loginUser',async (req,res) => {
    if (!req.body.id && !req.body.pub)
        return res.status(400).send({error: 'User ID or public key is required'})
    else if (!req.body.key)
        return res.status(400).send({error: 'Key is required'})

    let id = req.body.id

    if (!id && req.body.pub)
        id = await db.getIdFromPub(req.body.pub)
    if (!id)
        return res.status(404).send({error: 'Public key does not exist'})
    db.login(id,req.body.key,(e) => helper.cbHandler(e,res))
})

// Change user key
app.post('/changeKey',(req,res) => {
    if (!req.body.id && !req.body.pub)
        return res.status(400).send({error: 'User ID or public key is required'})
    else if (!req.body.key)
        return res.status(400).send({error: 'Old key is required'})
    else if (!req.body.newkey)
        return res.status(400).send({error: 'New key is required'})

    if (!req.body.id && req.body.pub) db.getIdFromPub(req.body.pub,(id) => {
        if (!id)
            return res.status(404).send({error: 'Public key does not exist'})
        db.changeKey(id,req.body.key,req.body.newkey,(e) => helper.cbHandler(e,res))
    })
    else
        db.changeKey(req.body.id,req.body.key,req.body.newkey,(e) => helper.cbHandler(e,res))
})

// Current logged in user (if any)
app.get('/currentUser',(req,res) => {
    let currentUser = db.currentUser()
    if (!currentUser)
        res.send({loggedIn: false})
    else {
        currentUser.loggedIn = true
        res.send(currentUser)
    }
})

app.get('/fetchParticipantsKeys',async (req,res) => {
    if (!db.currentUser())
        return res.status(401).send({error: 'Not logged in'})
    let authorizedKeys = await db.fetchStreamParticipants(db.currentUser().pub,config.chat_listener)
    res.send(authorizedKeys)
})

// Push new stream chunk as current logged in user
app.post('/pushStream',(req,res) => {
    let currentUser = db.currentUser()
    if (!currentUser)
        return res.status(401).send({error: 'Not logged in'})
    let streamValidator = validator.stream(req.body)
    if (streamValidator !== null)
        return res.status(400).send({error: streamValidator})
    db.pushStream(req.body,(e) => helper.cbHandler(e,res))
})

// Get stream by public key and link
app.get('/getStream',async (req,res) => {
    if (!req.query.pub)
        return res.status(400).send({error: 'Missing streamer public key'})
    let reqValidate = validator.streamLink(req.query)
    if (reqValidate !== null)
        return res.status(400).send({error: reqValidate})
    res.send(await db.getListFromUser(req.query.pub,req.query.network + '/' + req.query.streamer + '/' + req.query.link,false,0))
})

module.exports = app