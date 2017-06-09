'use strict';

const express = require('express');
const app = express();

const bodyParser = require('body-parser');
const cors = require('cors');
const FabricCAServices = require('fabric-ca-client');
const FabricClient = require('fabric-client');
const FabricClientUtils = require('fabric-client/lib/utils.js');
const fs = require('fs');
const http = require('http');
const path = require('path');
const winston = require('winston');
const util = require('util');

function assert (condition, message) {
    if (!condition) {
        logger.error('!!! assert FAILED !!! message: ' + message);
        logger.error('!!! stack trace:');
        const err = new Error(message);
        logger.error(err.stack);
        throw err;
    }
}

function sleep (milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function assemble_url_from_remote (remote) {
    return remote.protocol + '://' + remote.host + ':' + remote.port;
}

///////////////////////////////////////////////////////////////////////////////
//////////////////////////////// SET CONFIGURATONS ////////////////////////////
///////////////////////////////////////////////////////////////////////////////

app.options('*', cors());
app.use(cors());
// Support parsing of application/json type post data
app.use(bodyParser.json());
// Support parsing of application/x-www-form-urlencoded post data
app.use(bodyParser.urlencoded({
    extended: false
}));
const logger = new(winston.Logger)({
    level: 'debug',
    transports: [
        new(winston.transports.Console)({
            colorize: true
        }),
    ]
});

// Make node do something more reasonable with this type of error.
process.on('unhandledRejection', (r) => logger.error(r));

///////////////////////////////////////////////////////////////////////////////
//////////////////////////// CHANNEL CREATION /////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

class SimpleClient {
    constructor () {
        // Read in the configuration files.
        const netcfg = this.netcfg = require('../../netcfg.json'); // read-only configuration for peer network
        const appcfg = this.appcfg = require('../../appcfg.json'); // read-only configuration for application

        logger.debug('SimpleClient()');
        logger.debug('netcfg: %j', netcfg);
        logger.debug('appcfg: %j', appcfg);

        // Create organizations.
        this.organizations  = {};
        for (const org_name in netcfg.organizations) {
            const org_cfg   = netcfg.organizations[org_name];
            logger.debug('creating organization "%s" using cfg %j', org_name, org_cfg);
            const org       = {};
            const client    = new FabricClient();
            // TODO: client.addConfigFile

            org.client = client;

            // Add the CA, if it's defined.
            if (org_cfg.ca) {
                const ca_cfg            = org_cfg.ca;
                logger.debug('creating CA using cfg %j', ca_cfg);
                const cryptoSuite_path  = appcfg.cryptoSuite_path_prefix + org_name;
                const cryptoSuite       = client.newCryptoSuite({
                    path: cryptoSuite_path
                });
                org.ca = new FabricCAServices(
                    assemble_url_from_remote(ca_cfg.remote),
                    ca_cfg.tlsOptions,
                    ca_cfg.caname,
                    cryptoSuite
                );
            }

            // Add the orderers.
            org.orderers = {};
            for (const orderer_name in org_cfg.orderers) {
                const orderer_cfg           = org_cfg.orderers[orderer_name];
                logger.debug('creating orderer "%s" using cfg %j', orderer_name, orderer_cfg);
//                 const orderer_tls_cacerts = fs.readFileSync(path.join(__dirname, orderer_cfg.orderer_tls_cacerts_path));
                org.orderers[orderer_name]  = client.newOrderer(
                    assemble_url_from_remote(orderer_cfg.remote),
                    {
                        // NOTE: Currently TLS is disabled on the orderer, so leaving this out is fine.
    //                     'pem'                     : Buffer.from(orderer_tls_cacerts).toString(),
    //                     'ssl-target-name-override': orderer_cfg.ssl_target_name_override
                    }
                );
            }

            // Add the peers.
            org.peers = {};
            for (const peer_name in org_cfg.peers) {
                const peer_cfg          = org_cfg.peers[peer_name];
                logger.debug('creating peer "%s" using cfg %j', peer_name, peer_cfg);
                const peer_tls_cacerts  = fs.readFileSync(path.join(__dirname, peer_cfg.peer_tls_cacerts_path));
                const peer              = client.newPeer(
                    assemble_url_from_remote(peer_cfg.requests_remote),
                    {
                        'pem'                     : Buffer.from(peer_tls_cacerts).toString(),
                        'ssl-target-name-override': peer_cfg.ssl_target_name_override
                    }
                );
//                 chain.addPeer(peer); // TODO: add the peer to chain in a separate pass -- the application defines the chain/channel
                org.peers[peer_name] = peer;
            }

            // Make empty channels dict.
            org.channels = {};

            // TODO: Maybe save org_cfg as org.cfg

            this.organizations[org_name] = org;
        }

        // Create channel architectures.  The way this works is that organizations which are listed as participants in
        // a channel have newChain called on their Client object.
        for (const channel_name in appcfg.channels) {
            const channel_cfg           = appcfg.channels[channel_name];

            for (const participating_org_name of channel_cfg.participating_organizations) {
                logger.debug('creating channel architecture for channel "%s" and participating org "%s"', channel_name, participating_org_name);
                const org               = this.organizations[participating_org_name];
                const client            = org.client;
                const channel           = {};
                const chain             = client.newChain(channel_name);

                logger.debug('created chain: %j', chain);
                channel.chain           = chain;

                // Add the orderer to the chain.
                {
                    assert(channel_cfg.orderer_specs.length == 1, 'must specify exactly one element in the orderer_specs attribute of each channel in appcfg.json');
                    const orderer_spec  = channel_cfg.orderer_specs[0];
                    chain.addOrderer(this.organizations[orderer_spec.organization_name].orderers[orderer_spec.orderer_name]);
                }

                // Add the peers to the chain
                for (const peer_spec of channel_cfg.peer_specs) {
                    chain.addPeer(this.organizations[peer_spec.organization_name].peers[peer_spec.peer_name]);
                }

                org.channels[channel_name] = channel;
            }
        }
    }

    // Returns a promise for creation of a kvs for each organization.
    create_kvs_for_each_org__p () {
        logger.debug('create_kvs_for_each_org__p();');
        const promises = [];
        for (const org_name in this.organizations) {
            const org       = this.organizations[org_name];
            const client    = org.client;
            logger.debug('    client: %j', client);
            const kvs_path  = this.appcfg.kvs_path_prefix + org_name;
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

    // Returns a promise for enrollment of all users for each organization.
    // This is not minimally necessary, but who cares for now.
    // Must have called and resolved create_kvs_for_each_org__p before calling this method.
    enroll_all_users_for_each_org__p () {
        logger.debug('enroll_all_users_for_each_org__p();');
        const promises = [];
        for (const org_name in this.organizations) {
            const org           = this.organizations[org_name];
            const org_cfg       = this.netcfg.organizations[org_name];
            const client        = org.client;
            for (const user_name in org_cfg.users) {
                const user_cfg                  = org_cfg.users[user_name];
                // TODO: Probably specify cert/key filenames directly, instead of relying on particular dir structure/filename scheme
                const user_msp_cert_dir         = fs.readdirSync(path.join(__dirname, user_cfg.msp_path, 'signcerts'));
                assert(user_msp_cert_dir.length == 1, util.format('msp/signcerts directory must contain exactly 1 entry; actual was %j', user_msp_cert_dir));
                const user_msp_key_dir          = fs.readdirSync(path.join(__dirname, user_cfg.msp_path, 'keystore'));
                assert(user_msp_key_dir.length == 1, util.format('msp/keystore directory must contain exactly 1 entry; actual was %j', user_msp_key_dir));
                logger.debug('    org_name: "%s", user_name: "%s", user_msp_cert_dir: %j, user_msp_key_dir: %j', org_name, user_name, user_msp_cert_dir, user_msp_key_dir);
                const user_msp_cert_filename    = path.join(__dirname, user_cfg.msp_path, 'signcerts', user_msp_cert_dir[0]);
                const user_msp_key_filename     = path.join(__dirname, user_cfg.msp_path, 'keystore', user_msp_key_dir[0]);
                const user_msp_cert             = fs.readFileSync(user_msp_cert_filename);
                const user_msp_key              = fs.readFileSync(user_msp_key_filename);
                logger.debug('    calling client.createUser on user_cfg "%s" for organization "%s"', user_name, org_name);
                promises.push(
                    client.createUser({
                        // Note -- this does not need to be the same as user_name -- it could be anything.
                        // It just identifies the user to the client.
                        username     : user_name,
                        mspid        : org_cfg.mspid,
                        cryptoContent: {
                            signedCertPEM: Buffer.from(user_msp_cert).toString(),
                            privateKeyPEM: Buffer.from(user_msp_key).toString()
                        }
                    })
                    .then((user) => {
                        logger.debug('    client.createUser succeeded; user_name = "%s", org_name = "%s"', user_name, org_name);
                        // This doesn't work because client is not reentrant (the user parameter is client._userContext
                        // which if set by multiple parallel tasks, will screw things up).
//                         logger.debug('    client.createUser succeeded; user.getName() = "%s", org_name = "%s"', user.getName(), org_name);
                    })
                );
            }
        }
        return Promise.all(promises);
//         // Normally Promise.all(promises) should be called to process these in parallel, but client
//         // is non-reentrant due to its "user context" state.
//         const initial_promise = Promise.resolve(42); // dummy value -- is this necessary?
//         let current_promise = initial_promise;
//         for (const promise of promises) {
//             current_promise = current_promise.then(promise);
//         }
//         return current_promise;
    }

    create_channels__p () {
        logger.debug('create_channels__p();');
        const promises = [];
        for (const channel_name in this.appcfg.channels) {
            const channel_cfg               = this.appcfg.channels[channel_name];
            logger.debug('attempting to read config of channel "%s"; config is %j', channel_name, channel_cfg);
            const channel_creator_org       = this.organizations[channel_cfg.channel_creator_spec.organization_name];
            logger.debug('channel_creator_org keys: %j', Object.keys(channel_creator_org));
            const channel_creator_client    = channel_creator_org.client;
            const channel                   = channel_creator_org.channels[channel_name];
            logger.debug('channel: %j', channel);
            const channel_orderers          = channel.chain.getOrderers();
            assert(channel_orderers.length == 1, 'currently you may only specify one orderer per channel');
            const channel_orderer           = channel_orderers[0];
            const configtx                  = fs.readFileSync(path.join(__dirname, channel_cfg.configtx_path));
            promises.push(
                channel_creator_client.getUserContext(channel_cfg.channel_creator_spec.user_name, true)
                .then((channel_creator_user) => {
                    logger.debug('channel_creator_user: %j', channel_creator_user);
                    const extracted_channel_config  = channel_creator_client.extractChannelConfig(configtx);
                    const signature                 = channel_creator_client.signChannelConfig(extracted_channel_config);
                    const nonce                     = FabricClientUtils.getNonce();
                    const txId                      = FabricClient.buildTransactionID(nonce, channel_creator_user);
                    logger.debug('creating channel "%s" using organization "%s"\'s client', channel_name, channel_creator_org);
                    return channel_creator_client.createChannel({
                        name: channel_name,
                        orderer: channel_orderer,
                        config: extracted_channel_config,
                        signatures: [signature],
                        txId: txId,
                        nonce: nonce
                    });
                })
                .then((result) => {
                    logger.debug('    successfully created channel "%s" using organization "%s"\'s client; result: %j', channel_name, channel_creator_org, result);
                })
            );
        }
        return Promise.all(promises);
    }
/*
    join_channel__p () {
        logger.debug('join_channel__p();');

        // First we must retrieve the genesis block.  Presumably this can be done from any client just like createChannel.
        const org_name = this.org_names[0];
        const org_cfg = this.netcfg.organizations[org_name];
        const client = this.client_for_org[org_name];
        const chain = this.chain_for_org[org_name]; // Could potentially use client.getChain here instead of using this.chain_for_org
        const admin_user = client.getUserContext(org_cfg.ca.admin_username, false); // false indicates synchronous call.

        const nonce = utils.getNonce();
        const txId = FabricClient.buildTransactionID(nonce, admin_user);
        return chain.getGenesisBlock({
            txId: txId,
            nonce: nonce
        })
        .then((genesis_block) => {
        })

        return chain.getGenesisBlock(request);
        return chain.



//   const nonce = utils.getNonce();
//   const txId = HFC.buildTransactionID(nonce, admin);
//   const request = {
//     txId: txId,
//     nonce: nonce
//   };
//   return chain.getGenesisBlock(request);


        const promises = [];
        for (const org_name in this.netcfg.organizations) {
            const chain = this.chain_for_org[org_name];
            promises.push(
                client.joinChannel({
                    targets: chain.getPeers(),
                    block  :



        const org_name = this.org_names[0];
//         const org_cfg = this.netcfg.organizations[org_name];
//         const client = this.client_for_org[org_name];
//         const chain  = this.chain_for_org[org_name];
//         const channel_name = this.appcfg.channelName;
//         const configtx = fs.readFileSync(path.join(__dirname, this.appcfg.configtx_path));
//
//         logger.debug('create_channel__p();');
//         logger.debug('    creating channel with name "%s"', channel_name);
//         logger.debug('    via orderer: %j', this.orderer);
//
//         // True indicates async call to retrieve the User object, and will also call client.setUserContext.
//         return client.getUserContext(org_cfg.ca.admin_username, true)
//         .then((user) => {
//             // This call uses the current user to sign.
//             const channel_cfg = client.extractChannelConfig(configtx);
//             const signature = client.signChannelConfig(channel_cfg);
//             const nonce = FabricClientUtils.getNonce();
//             const txId = FabricClient.buildTransactionID(nonce, user);
//             return client.createChannel({
//                 name: this.appcfg.channelName,
//                 orderer: this.orderer,
//                 config: channel_cfg,
//                 signatures: [signature],
//                 txId: txId,
//                 nonce: nonce
//             });
//         })
//         .then((result) => {
//             logger.debug('    successfully created channel "%s"; result: %j', channel_name, result);
//         });
    }
*/
    // NOTE: Transactions (and other user-dependent actions) should call setUserContext before transacting.
};

const simple_client = new SimpleClient();

// console.log('simple_client:');
// console.log(simple_client);

Promise.resolve()
.then(() => {
    return simple_client.create_kvs_for_each_org__p()
})
.then(() => {
    for (let i = 0; i < 10; i++) {
        logger.debug('---------------------------------------------------------------------------');
    }
    logger.debug('-- pausing for a moment to let the human reader catch up ------------------');
    return sleep(1000);
})
.then(() => {
    return simple_client.enroll_all_users_for_each_org__p()
})
.then(() => {
    for (let i = 0; i < 10; i++) {
        logger.debug('---------------------------------------------------------------------------');
    }
    logger.debug('-- pausing for a moment to let the human reader catch up ------------------');
    return sleep(1000);
})
.then(() => {
    return simple_client.create_channels__p()
});

/*
///////////////////////////////////////////////////////////////////////////////
//////////////////////////////// START SERVER /////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

const server = http.createServer(app).listen(context.port, function(){});
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
