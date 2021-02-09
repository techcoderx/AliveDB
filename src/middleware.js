// This is where peers can hand pick streams and live chat content
// that they wish to propogate throughout the p2p network. If enough
// peers have chosen not to store certain contents, it may become
// unretrievable. Hence, on-chain direct streams should be used if
// immutability is very important.

// By default, we reject live chat messages that are not signed
// with a valid key, and perhaps messages from those who are banned
// by moderators which are only approved by streamers themselves.

// To use this middleware, import this file right after importing gundb.
const GunDB = require('gun/gun')
const axios = require('axios')
const cg = require('./cryptography')
const config = require('./config')

// todo detect for public key updates in realtime?
let participants = {
    dtc: {},
    hive: {},
    steem: {}
}

let recentMsg = {}

GunDB.on('opt',function (ctx) {
    if (ctx.once) return
    this.to.next(ctx)

    ctx.on('in',async function (msg) {
        if (msg.put) {
            let key = Object.keys(msg.put)
            let keydet = key[0].split('/')
            let received = msg.put[key[0]]
            if (key.length > 0 && keydet[0] === 'alivedb_chat' && keydet.length === 5) {
                // when screening data outside of Gun.user() namespace,
                // the first (root) key should not start with '~'
                // for live chat, keys would be 'alivedb_chat' -> network -> streamer -> link -> messageId
                // message content template:
                /*
                {
                    u: 'username',
                    n: 'network (dtc, hive, steem etc)',
                    s: 'signature',
                    r: recid,
                    t: timestamp,
                    m: 'my chat message goes here'
                }
                */
                if (!received.u || !received.n || !received.s || (received.n === 'dtc' && !received.r && received.r !== 0) || !received.t || !received.m) return
                if (typeof received.u !== 'string' || typeof received.s !== 'string' || (received.r && typeof received.r !== 'number') || typeof received.t !== 'number' || typeof received.m !== 'string') return
                if (!participants[received.n]) return

                // All messages must be unique
                if (recentMsg[received.s]) return

                // Recover public key from message signature
                let pubkeystr = ''
                try {
                    let hash = cg.createHash(received.t,received.u,received.n,received.m)
                    if (received.n === 'dtc')
                        pubkeystr = cg.avalonEncode(cg.avalonRecoverFromSig(received.s,received.r,hash))
                    else
                        pubkeystr = cg.Signature.fromString(received.s).recover(hash)
                } catch { return }

                // Verify public key in account
                // let validKeys = await getAccountKeys(received.u,received.n)
                // if (!validKeys.includes(pubkeystr)) return
                // recentMsg[received.s] = received.t
                console.log('received valid chat from',pubkeystr,msg.put)
            } else if (key.length > 0 && key[0].startsWith('alivedb_chat_request/'+config.chat_listener) && keydet.length === 6) {
                // AliveDB chat participation request received
                // Format should be alivedb_chat_request/stream_network/streamer/link/participant_network/participant_username
                if (!gunUser || !gunUser.is) return
                if (!received.s || !received.t) return
                if (typeof received.s !== 'string' || typeof received.t !== 'number') return
                if (!participants[keydet[4]]) return
                if (keydet[4] === 'dtc' && !received.r && received.r !== 0 && typeof received.r !== 'number') return
                if (Math.abs(received.t - received._['>'].t) > 5000) return
                if (Math.abs(received.t - new Date().getTime() > 10000)) return
                gunUser.get(config.chat_listener+'/participants').get(keydet[4]).get(keydet[5]).once(async (val) => {
                    if (!val && val !== 0) {
                        // Verify signature
                        let validKeys = []
                        try {
                            let hash = cg.createHashRequest(received.t,keydet[5],keydet[4])
                            let pubkeystr = ''
                            if (received.n === 'dtc')
                                pubkeystr = cg.avalonEncode(cg.avalonRecoverFromSig(received.s,received.r,hash))
                            else
                                pubkeystr = cg.Signature.fromString(received.s).recover(hash)
                            validKeys = await getAccountKeys(keydet[5],keydet[4])
                            if (!validKeys.includes(pubkeystr)) return
                        } catch { return }
                        gunUser.get(config.chat_listener+'/participants').get(keydet[4]).get(keydet[5]).put(1,(ack) => {
                            if (ack.ok) console.log('Successfully approved',keydet[5],keydet[4])
                            participants[keydet[4]][keydet[5]] = validKeys
                        })
                    }
                })
                return
            }
        }
        // valid data received, proceed to next middleware
        this.to.next(msg)
    })
})

function getAccountKeys(user,network) {
    return new Promise(async (rs,rj) => {
        if (participants[network][user]) return rs(participants[network][user])
        // todo blockchain api config
        if (network === 'dtc')
            axios.get('https://avalon.oneloved.tube/account/'+user).then((d) => {
                // Allow master key and type 4 custom keys
                let allowedKeys = [d.data.pub]
                for (let i in d.data.keys)
                    if (d.data.keys[i].types.includes(4))
                        allowedKeys.push(d.data.keys[i].pub)
                participants.dtc[user] = allowedKeys
                rs(allowedKeys)
            }).catch(rj)
        else {
            let rpc = network === 'hive' ? 'https://techcoderx.com' : 'https://api.steemit.com'
            axios.post(rpc,{
                id: 1,
                jsonrpc: '2.0',
                method: 'condenser_api.get_accounts',
                params: [[user]]
            }).then((d) => {
                if (d.data.result && d.data.result.length > 0) {
                    // Allow posting, active and owner keys
                    let allowedKeys = []
                    for (let i in d.data.result[0].posting.key_auths)
                        allowedKeys.push(d.data.result[0].posting.key_auths[i][0])
                    for (let i in d.data.result[0].active.key_auths)
                        allowedKeys.push(d.data.result[0].active.key_auths[i][0])
                    for (let i in d.data.result[0].owner.key_auths)
                        allowedKeys.push(d.data.result[0].owner.key_auths[i][0])
                    participants[network][user] = allowedKeys
                    rs(allowedKeys)
                } else rj(d.data.error)
            }).catch(rj)
        }
    })
}