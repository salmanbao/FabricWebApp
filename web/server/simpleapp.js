'use strict';

var express = require('express');
var app = express();

var bodyParser = require('body-parser');
var cors = require('cors');
var FabricCAServices = require('fabric-ca-client');
var FabricClient = require('fabric-client');
var fs = require('fs');
var http = require('http');
var Orderer = require('fabric-client/lib/Orderer.js');
var path = require('path');
var Peer = require('fabric-client/lib/Peer.js');
var winston = require('winston');
var User = require('fabric-client/lib/User.js');
var util = require('util');

function assert (condition, message) {
    if (!condition) {
        logger.error('!!! assert FAILED !!! message: ' + message);
        logger.error('!!! stack trace:');
        let err = new Error(message);
        logger.error(err.stack);
        throw err;
    }
}

///////////////////////////////////////////////////////////////////////////////
//////////////////////////////// SET CONFIGURATONS ////////////////////////////
///////////////////////////////////////////////////////////////////////////////

app.options('*', cors());
app.use(cors());
//support parsing of application/json type post data
app.use(bodyParser.json());
//support parsing of application/x-www-form-urlencoded post data
app.use(bodyParser.urlencoded({
    extended: false
}));
var logger = new(winston.Logger)({
    level: 'debug',
    transports: [
        new(winston.transports.Console)({
            colorize: true
        }),
    ]
});

process.on('unhandledRejection', (r) => logger.error(r));

///////////////////////////////////////////////////////////////////////////////
//////////////////////////// CHANNEL CREATION /////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

class SimpleClient {
    constructor () {
        // Read in the configuration files.
        this.netcfg = require('../../netcfg.json'); // read-only configuration for peer network
        this.appcfg = require('../../appcfg.json'); // read-only configuration for application

        logger.debug('this.netcfg: %j', this.netcfg);
        logger.debug('this.appcfg: %j', this.appcfg);

        // Set up the orderer.
        {
            let tls_cacerts = fs.readFileSync(path.join(__dirname, this.netcfg.orderer.tls_cacerts_path));
            this.orderer    = new Orderer(
                this.netcfg.orderer.url,
                {
                    'pem'                     : Buffer.from(tls_cacerts).toString(),
                    'ssl-target-name-override': this.netcfg.orderer.server_hostname
                }
            );
        }

        // Create a client, chain, and CA for each organization.
        this.client_for_org = {}
        this.chain_for_org  = {}
        this.ca_for_org     = {}
        this.kvs_for_org    = {}
        for (let org_name in this.netcfg.organizations) {
            let org_cfg = this.netcfg.organizations[org_name];
            let client = new FabricClient();
            let chain = client.newChain(this.appcfg.channelName);
            let ca;

            // Set the orderer for each chain.
            chain.addOrderer(this.orderer);

            // Set up the peers for each chain
            for (let peername in this.netcfg.peers) {
                let peer_cfg    = this.netcfg.peers[peername];
                let tls_cacerts = fs.readFileSync(path.join(__dirname, peer_cfg.tls_cacerts_path));
                let peer        = new Peer(
                    'grpcs://' + peer_cfg.requests,
                    {
                        'pem'                     : Buffer.from(tls_cacerts).toString(),
                        'ssl-target-name-override': peer_cfg.server_hostname
                    }
                );
                chain.addPeer(peer);
            }

            // Set up the CA for each org.
            {
                let ca_cfg = org_cfg.ca;
                ca = new FabricCAServices(
                    ca_cfg.url,
                    ca_cfg.tlsOptions,
                    ca_cfg.caname,
                    null                // cryptoSuite
                );
            }

            // Store everything in the correct places in this object.
            this.client_for_org[org_name] = client;
            this.chain_for_org[org_name]  = chain;
            this.ca_for_org[org_name]     = ca;
            this.kvs_for_org[org_name]    = null; // Stub, since kvs is populated asynchronously.
        }
    }

    // Returns a promise for creation of kvss for all organizations.
    create_kvs_for_each_org__p () {
        logger.debug('create_kvs_for_each_org__p();');
        let promises = [];
        for (let org_name in this.netcfg.organizations) {
            let client = this.client_for_org[org_name];
            logger.debug('    client: %j', client);
            let kvs_path = this.appcfg.kvs_path_prefix + org_name;
            logger.debug('    creating kvs for organization "%s" using path "%s"', org_name, kvs_path);
            promises.push(
                FabricClient.newDefaultKeyValueStore({
                    path: kvs_path
                }).then((kvs) => {
                    logger.debug('    successfully created kvs for organization "%s"', org_name);
                    client.setStateStore(kvs);
                })
            );
        }
        return Promise.all(promises);
    }

    // Returns a promise for enrollment of admins for all organizations.
    // Must have called and resolved create_kvs_for_each_org__p before calling this method.
    enroll_admin_for_each_org__p () {
        logger.debug('enroll_admin_for_each_org__p();');
        let promises = [];
        for (let org_name in this.netcfg.organizations) {
            let org_cfg = this.netcfg.organizations[org_name];
            let admin_account = org_cfg.ca.admin_account;
            let client = this.client_for_org[org_name];
            let ca = this.ca_for_org[org_name];
            logger.debug('    enrolling admin user "%s" for organization "%s"', admin_account.enrollmentID, org_name);
            // NOTE: org_cfg.ca.admin_account must have keys
            // -    enrollmentID
            // -    enrollmentSecret
            promises.push(
                ca.enroll(admin_account)
                .then((enrollment_res) => {
                    logger.debug('    successfully enrolled user "%s"; now calling setEnrollment on that user', admin_account.enrollmentID);
                    let admin_user = new User(admin_account.enrollmentID, client);
//                     admin_user._enrollmentSecret = admin_account.enrollmentSecret;
                    return admin_user.setEnrollment(enrollment_res.key, enrollment_res.certificate, org_cfg.mspid);
                }).then(() => {
                    logger.debug('    successfully called setEnrollment on user "%s"', admin_account.enrollmentID);
                })
            );
        }
        return Promise.all(promises);
    }

    // NOTE: Transactions (and other user-dependent actions) should call setUserContext before transacting.
};

var simple_client = new SimpleClient();

console.log('simple_client:');
console.log(simple_client);

Promise.resolve()
.then(() => {
    return simple_client.create_kvs_for_each_org__p()
}).then(() => {
    return simple_client.enroll_admin_for_each_org__p()
});

/*
///////////////////////////////////////////////////////////////////////////////
//////////////////////////////// START SERVER /////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

var server = http.createServer(app).listen(context.port, function(){});
logger.info('****************** SERVER STARTED ************************');
logger.info('**************  http://' + context.host + ':' + context.port + '  ******************');
server.timeout = 240000;

///////////////////////////////////////////////////////////////////////////////
///////////////////////// REST ENDS START HERE ////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

// Register and enroll user
app.post('/users', function(req, res) {
    logger.debug('End point : /users');
    logger.debug('User name : ' + req.body.username);
    logger.debug('Org name  : ' + req.body.orgName);
    var token = jwt.sign({
        exp: Math.floor(Date.now() / 1000) + parseInt(config.jwt_expiretime),
        username: req.body.username,
        //TODO: Are we using existing user or to register new users ?
        //password: req.body.password,
        orgName: req.body.orgName
    }, app.get('secret'));
    var promise = helper.getRegisteredUsers(req.body.username, req.body.orgName, true);
    promise.then(function(response) {
        if (response && typeof response !== 'string') {
                    response.token = token;
                    res.json(response);
        } else {
            res.json({
                success: false,
                message: response
            });
        }
    });
});

// Create Channel
app.post('/channels', function(req, res) {
    logger.info('<<<<<<<<<<<<<<<<< C R E A T E  C H A N N E L >>>>>>>>>>>>>>>>>');
    logger.debug('End point : /channels');
    logger.debug('Channel name : ' + req.body.channelName);
    logger.debug('channelConfigPath : ' + req.body.channelConfigPath);
    var token = req.body.token || req.query.token || req.headers['x-access-token'];
    jwt.verify(token, app.get('secret'), function(err, decoded) {
        if (err) {
            res.send({
                success: false,
                message: 'Failed to authenticate token.'
            });
        } else {
            //res.send(d);
            logger.debug('User name : ' + decoded.username);
            logger.debug('Org name  : ' + decoded.orgName);
            var promise = channels.createChannel(req.body.channelName, req.body.channelConfigPath, decoded.username, decoded.orgName);
            promise.then(function(message) {
                res.send(message);
            });
        }
    });
});

// Join Channel
app.post('/channels/:channelName/peers', function(req, res) {
    logger.info('<<<<<<<<<<<<<<<<< J O I N  C H A N N E L >>>>>>>>>>>>>>>>>');
    logger.debug('peers : ' + req.body.peers);
    var token = req.body.token || req.query.token || req.headers['x-access-token'];
    jwt.verify(token, app.get('secret'), function(err, decoded) {
        if (err) {
            res.send({
                success: false,
                message: 'Failed to authenticate token.'
            });
        } else {
            //res.send(d);
            logger.debug('User name : ' + decoded.username);
            logger.debug('Org name  : ' + decoded.orgName);
            var promise = join.joinChannel(req.params.channelName, req.body.peers, decoded.username, decoded.orgName);
            promise.then(function(message) {
                res.send(message);
            }, (err) => {
                var error_message = util.format('join channel promise failed; error was: %j', err);
                logger.info(error_message);
                res.send({
                    success: false,
                    message: error_message
                });
            });
        }
    });
});

// Install chaincode on target peers
app.post('/chaincodes', function(req, res) {
    logger.debug('==================== INSTALL CHAINCODE ==================');
    logger.debug('peers : ' + req.body.peers); // target peers list
    logger.debug('chaincodeName : ' + req.body.chaincodeName);
    logger.debug('chaincodePath  : ' + req.body.chaincodePath);
    logger.debug('chaincodeVersion  : ' + req.body.chaincodeVersion);
    var token = req.body.token || req.query.token || req.headers['x-access-token'];
    jwt.verify(token, app.get('secret'), function(err, decoded) {
        if (err) {
            res.send({
                success: false,
                message: 'Failed to authenticate token.'
            });
        } else {
            //res.send(d);
            logger.debug('User name : ' + decoded.username);
            logger.debug('Org name  : ' + decoded.orgName);
            var promise = install.installChaincode(req.body.peers, req.body.chaincodeName, req.body.chaincodePath, req.body.chaincodeVersion, decoded.username, decoded.orgName);
            promise.then(function(message) {
                res.send(message);
            });
        }
    });
});

// Instantiate chaincode on target peers
app.post('/channels/:channelName/chaincodes', function(req, res) {
    logger.debug('==================== INSTANTIATE CHAINCODE ==================');
    logger.debug('peers : ' + req.body.peers); // target peers list
    logger.debug('chaincodeName : ' + req.body.chaincodeName);
    logger.debug('chaincodePath  : ' + req.body.chaincodePath);
    logger.debug('chaincodeVersion  : ' + req.body.chaincodeVersion);
    var token = req.body.token || req.query.token || req.headers['x-access-token'];
    jwt.verify(token, app.get('secret'), function(err, decoded) {
        if (err) {
            res.send({
                success: false,
                message: 'Failed to authenticate token.'
            });
        } else {
            //res.send(d);
            logger.debug('User name : ' + decoded.username);
            logger.debug('Org name  : ' + decoded.orgName);
            var promise = instantiate.instantiateChaincode(req.body.peers, req.params.channelName, req.body.chaincodeName, req.body.chaincodePath, req.body.chaincodeVersion, req.body.functionName, req.body.args, decoded.username, decoded.orgName);
            promise.then(function(message) {
                res.send(message);
            });
        }
    });
});

// Invoke transaction on chaincode on target peers
app.post('/channels/:channelName/chaincodes/:chaincodeName', function(req, res) {
    logger.debug('==================== INVOKE ON CHAINCODE ==================');
    logger.debug('peers : ' + req.body.peers); // target peers list
    logger.debug('chaincodeName : ' + req.params.chaincodeName);
    logger.debug('Args : ' + req.body.args);
    logger.debug('chaincodeVersion  : ' + req.body.chaincodeVersion);
    var token = req.body.token || req.query.token || req.headers['x-access-token'];
    jwt.verify(token, app.get('secret'), function(err, decoded) {
        if (err) {
            res.send({
                success: false,
                message: 'Failed to authenticate token.'
            });
        } else {
            //res.send(d);
            logger.debug('User name : ' + decoded.username);
            logger.debug('Org name  : ' + decoded.orgName);
            let promise = invoke.invokeChaincode(req.body.peers, req.params.channelName, req.params.chaincodeName, req.body.chaincodeVersion, req.body.args, decoded.username, decoded.orgName);
            promise.then(function(message) {
                res.send(message);
            });
        }
    });
});

// Query on chaincode on target peers
app.get('/channels/:channelName/chaincodes/:chaincodeName', function(req, res) {
    logger.debug('==================== QUERY ON CHAINCODE ==================');
    logger.debug('channelName : ' + req.params.channelName);
    logger.debug('chaincodeName : ' + req.params.chaincodeName);
    let peer = req.query.peer;
    let args = req.query.args;
    args = args.replace(/'/g, '"');
    args = JSON.parse(args);
    logger.debug(args);
    let version = req.query.chaincodeVersion;
    var token = req.body.token || req.query.token || req.headers['x-access-token'];
    jwt.verify(token, app.get('secret'), function(err, decoded) {
        if (err) {
            res.send({
                success: false,
                message: 'Failed to authenticate token.'
            });
        } else {
            //res.send(d);
            logger.debug('User name : ' + decoded.username);
            logger.debug('Org name  : ' + decoded.orgName);
            var promise = query.queryChaincode(peer, req.params.channelName, req.params.chaincodeName, version, args, decoded.username, decoded.orgName);
            promise.then(function(message) {
                res.send(message);
            });
        }
    });
});

//  Query Get Block by BlockNumber
app.get('/channels/:channelName/blocks/:blockId', function(req, res) {
    logger.debug('==================== GET BLOCK BY NUMBER ==================');
    //logger.debug('peers : '+req.body.peers);// target peers list
    let blockId = req.params.blockId;
    let peer = req.query.participatingPeer;
    logger.debug('channelName : ' + req.params.channelName);
    logger.debug('BlockID : ' + blockId);
    logger.debug('PEER : ' + peer);
    var token = req.body.token || req.query.token || req.headers['x-access-token'];
    jwt.verify(token, app.get('secret'), function(err, decoded) {
        if (err) {
            res.send({
                success: false,
                message: 'Failed to authenticate token.'
            });
        } else {
            logger.debug('User name : ' + decoded.username);
            logger.debug('Org name  : ' + decoded.orgName);
            var promise = query.getBlockByNumber(peer, blockId, decoded.username, decoded.orgName);
            promise.then(function(message) {
                res.send(message);
            });
        }
    });
});

// Query Get Transaction by Transaction ID
app.get('/channels/:channelName/transactions/:trxnId', function(req, res) {
    logger.debug('================ GET TRANSACTION BY TRANSACTION_ID ======================');
    logger.debug('channelName : ' + req.params.channelName);
    let trxnId = req.params.trxnId;
    let peer = req.query.participatingPeer;
    var token = req.body.token || req.query.token || req.headers['x-access-token'];
    jwt.verify(token, app.get('secret'), function(err, decoded) {
        if (err) {
            res.send({
                success: false,
                message: 'Failed to authenticate token.'
            });
        } else {
            logger.debug('User name : ' + decoded.username);
            logger.debug('Org name  : ' + decoded.orgName);
            var promise = query.getTransactionByID(peer, trxnId, decoded.username, decoded.orgName);
            promise.then(function(message) {
                res.send(message);
            });
        }
    });
});

// Query Get Block by Hash
app.get('/channels/:channelName/blocks', function(req, res) {
    logger.debug('================ GET BLOCK BY HASH ======================');
    //logger.debug('peers : '+req.body.peers);// target peers list
    logger.debug('channelName : ' + req.params.channelName);
    let hash = req.query.hash;
    let peer = req.query.participatingPeer;
    var token = req.body.token || req.query.token || req.headers['x-access-token'];
    jwt.verify(token, app.get('secret'), function(err, decoded) {
        if (err) {
            res.send({
                success: false,
                message: 'Failed to authenticate token.'
            });
        } else {
            logger.debug('User name : ' + decoded.username);
            logger.debug('Org name  : ' + decoded.orgName);
            var promise = query.getBlockByHash(peer, hash, decoded.username, decoded.orgName);
            promise.then(function(message) {
                res.send(message);
            });
        }
    });
});

//Query for Channel Information
app.get('/channels/:channelName', function(req, res) {
    logger.debug('================ GET CHANNEL INFORMATION ======================');
    //logger.debug('peers : '+req.body.peers);// target peers list
    logger.debug('channelName : ' + req.params.channelName);
    let peer = req.query.participatingPeer;
    var token = req.body.token || req.query.token || req.headers['x-access-token'];
    jwt.verify(token, app.get('secret'), function(err, decoded) {
        if (err) {
            res.send({
                success: false,
                message: 'Failed to authenticate token.'
            });
        } else {
            logger.debug('User name : ' + decoded.username);
            logger.debug('Org name  : ' + decoded.orgName);
            var promise = query.getChainInfo(peer, decoded.username, decoded.orgName);
            promise.then(function(message) {
                res.send(message);
            });
        }
    });
});

// Query to fetch all Installed/instantiated chaincodes
app.get('/chaincodes', function(req, res) {
    var hostingPeer = req.query.hostingPeer;
    var isInstalled = req.query.installed;
    if (isInstalled === 'true') {
        logger.debug('================ GET INSTALLED CHAINCODES ======================');
    } else {
        logger.debug('================ GET INSTANTIATED CHAINCODES ======================');
    }
    //logger.debug('peers : '+req.body.peers);// target peers list
    logger.debug('hostingPeer: ' + req.query.hostingPeer);
    var token = req.body.token || req.query.token || req.headers['x-access-token'];
    jwt.verify(token, app.get('secret'), function(err, decoded) {
        if (err) {
            res.send({
                success: false,
                message: 'Failed to authenticate token.'
            });
        } else {
            logger.debug('User name : ' + decoded.username);
            logger.debug('Org name  : ' + decoded.orgName);
            var promise = query.getInstalledChaincodes(hostingPeer, isInstalled, decoded.username, decoded.orgName);
            promise.then(function(message) {
                res.send(message);
            });
        }
    });
});

// Query to fetch channels
app.get('/channels', function(req, res) {
    logger.debug('================ GET CHANNELS ======================');
    logger.debug('End point : /channels');
    //logger.debug('peers : '+req.body.peers);// target peers list
    logger.debug('participatingPeer: ' + req.query.participatingPeer);
    var participatingPeer = req.query.participatingPeer;
    var token = req.body.token || req.query.token || req.headers['x-access-token'];
    jwt.verify(token, app.get('secret'), function(err, decoded) {
        if (err) {
            res.send({
                success: false,
                message: 'Failed to authenticate token.'
            });
        } else {
            logger.debug('User name : ' + decoded.username);
            logger.debug('Org name  : ' + decoded.orgName);
            var promise = query.getChannels(participatingPeer, decoded.username, decoded.orgName);
            promise.then(function(message) {
                res.send(message);
            });
        }
    });
});
*/
