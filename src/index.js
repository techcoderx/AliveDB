const Config = require('./config')
const helper = require('./helper')
const validator = require('./validator')
const db = require('./alivedb')
const Express = require('express')
const bodyParser = require('body-parser')
const app = Express()
const http = require('http').Server(app)

db.init()

// parse application/json
app.use(bodyParser.json())

// Create AliveDB user account
app.post('/createUser',(req,res) => {
    let id = req.body.id || helper.randomId(16)
    let key = req.body.key
    let keyValidate = validator.aliveDbKey(key)

    if (keyValidate !== null)
        return res.status(400).send({error: keyValidate})

    db.createUser(id,key,(e,pub) => {
        if (e)
            return res.status(500).send({error: e})
        res.send({id: id, pub: pub})
    })
})

// User login
// Use id or public key
app.post('/loginUser',(req,res) => {
    if (!req.body.id && !req.body.pub)
        return res.status(400).send({error: 'User ID or public key is required'})
    else if (!req.body.key)
        return res.status(400).send({error: 'Key is required'})

    if (!req.body.id && req.body.pub) db.getIdFromPub(req.body.pub,(id) => {
        if (!id)
            return res.status(404).send({error: 'Public key does not exist'})
        db.login(id,req.body.key,(e) => helper.loginHandler(e,res))
    })
    else
        db.login(req.body.id,req.body.key,(e) => helper.loginHandler(e,res))
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

http.listen(Config.http_port,() => console.log(`AliveDB API server listening on port ${Config.http_port}`))