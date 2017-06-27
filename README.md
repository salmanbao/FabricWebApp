# Hyperledger Fabric Example App using node.js SDK

This was originally a fork of https://github.com/ratnakar-asara/Fabric_SampleWebApp

## Instructions

Clone this repo with the following command.

    git clone https://github.com/vdods/Fabric_SampleWebApp.git

In one terminal, generate all configuration and cryptographic artifacts, spin up the peer network, orderer,
certificate authorities, and web server (which hosts the web app) with the following command.  See `Makefile`
for details.

    make up

The web app (in `web/server/SimpleApp.js`) will automatically read the application and network configuration files
(`web/server/appcfg.json` and `web/server/netcfg.json` respectively), create necessary keystores, enroll all users
defined in `netcfg.json`, create all channels defined in `appcfg.json`, send participating organizations invitation
to join the respective channels, install/instantiate chaincode on the peers of each channel, and then make a few
queries and transactions on `mychannel`.  The web app should exit with code 0, indicating success, at which point,
the docker-compose services should shut down on their own (see `docker-compose up --abort-on-container-exit` for details).
If an error occurs, it will be indicated, and the docker-compose services will be shut down.

## Structure Of Project

TODO document
-   Project structure
-   What are source files
-   What are generated
-   docker-compose volumes

## Finer-grained Instructions

There are several `make` targets that make controlling the docker-compose services defined in `docker-compose.yaml`
easier.

### Building and Doing Stuff

-   The command

        make all-generated-artifacts

    will ensure that the following artifacts are generated:
    -   Cryptographic materials in `generated-artifacts/crypto-config`
    -   Configuration transaction in `generated-artifacts/mychannel.tx`
    -   Orderer genesis block in `generated-artifacts/orderer.genesis.block`

    The `generated-artifacts` directory contains all generated artifacts and only generated artifacts (no source artifacts),
    and therefore can be entirely deleted without worry.

-   The command

        make up

    ensures that all necessary artifacts are generated (into the `generated-artifacts` subdir), and creates and starts all
    services, volumes, and networks and prints all services' logs to the console.  Hitting Ctrl+C in this mode
    will stop all services.  If any container exits, all will exit.  There are three volumes:
    -   `fabricsamplewebapp_webserver_homedir` : Stores the home directory of the user that runs the web server.  In particular, this
        stores the `~/.hfc-key-store` directory.
    -   `fabricsamplewebapp_webserver_homedir_node_modules` : Stores the `node_modules` directory for the web server.  This will really
        only be populated once and won't need updating often, nor does it typically need to be deleted before restarting the
        web server.
    -   `fabricsamplewebapp_webserver_tmp` : Stores the key/value store for each organization in the network.

-   The command

        make up-detached

    does the same as `make up` except that it spins up all services in the background and does not print logs to the console.

-   The command

        make logs-follow

    can be used voluntarily, in the case that `make up-detached` was used, to follow the services' log printouts.
    Hitting Ctrl+C will detach from the log printout but not stop the services.  Note that currently the peers' state
    is not persisted between runs, so the blockchain will be lost upon stopping the containers.

-   The command

        make down

    brings down all services, but do not delete any persisted volumes (i.e. docker-based persistent storage).  Note that
    currently the peers' state is not persisted between runs, so the blockchain will be lost upon stopping the containers.

-   The command

        make down-full

    brings down all services and delete all volumes.  This clears all state (of peers, orderer, CAs, web server, etc).

-   The command

        make down && make rm-state-volumes && make up

    is a convenient single command you can use after stopping services to reset all services back to a clean state
    and restart them, following the services' logs.  There is typically no need to delete the persistent `node_modules`
    directory (contained within the fabricsamplewebapp_webserver_homedir_node_modules docker volume and deleted by the
    `make rm-node-modules` command) because it is not likely to qualitatively change or be corrupted (though that does
    happen sometimes during development for various reasons).  Note that the web server service in `docker-compose.yaml`
    does execute the command `npm install`, so any updates to `web/server/package.json` should automatically take effect.

### Viewing Stuff

-   The command

        make show-all-generated-resources

    will show all non-source resources that this project created that currently still exist.  See also
    the `make rm-all-generated-resources` command.

### Deleting Stuff

-   The command

        make rm-state-volumes

    deletes the persistent storage of the web server (in particular, the `fabricsamplewebapp_webserver_tmp` and
    `fabricsamplewebapp_webserver_homedir` volumes), and can be used for example to reset the web server to a 'clean'
    state, not having anything in the key/value store(s).  This can be executed only if the services are not up.
    WARNING: This will delete all of your webserver keystore data, and is IRREVERSIBLE!

-   The command

        make rm-node-modules

    deletes the node_modules directory of the web server (in particular, the `fabricsamplewebapp_webserver_homedir_node_modules` volume).  This can be executed only if the services are not up.  This does not delete any real data that can't
    be easily recreated, though it may involve downloading a lot of node.js dependencies.

-   The command

        make rm-generated-artifacts

    will delete all generated artifacts.  In particular, it will delete the entire `generated-artifacts` directory.  This
    does not delete any real data that can't be easily recreated.

-   The command

        make rm-webserver-env

    will delete the docker image used by the web server.  This does not delete any real data that can't be easily recreated.

-   The command

        make rm-chaincode-docker-resources

    Deletes the docker containers created by the peers to run chaincode in net mode (which is default, as opposed to dev
    mode, specified by the `--peer-chaincodedev=true` option to the peer executable), as well as the docker images on which
    they run.  This shouldn't be necessary except to do a full clean-up, or when modifying chaincode (Fabric doesn't appear
    to detect that chaincode needs to be recompiled as of v1.0.0-alpha2).  This does not delete any real data that can't
    be easily recreated.

-   The command

        make rm-all-generated-resources

    or equivalently

        make clean

    will delete all non-source resources that this project created and currently still exist.  This should
    reset the project back to its original state with no leftover persistent data.  So be careful, because
    this will also delete your blockchain state and web server keystore.

## Random Notes

-   There is a bit of a hack in `docker-compose.yaml` in order to retrieve the private key filename in various situations.
    This is done by specifying

        --ca.keyfile `ls -1 /etc/hyperledger/fabric-ca-server-config/*_sk`

    in the command to start each CA service.  If there is more than one file in that directory matching the `*_sk` pattern,
    then this will cause the CA (in this case, `ca.org1.example.com`) to stop with error

        ca.org1.example.com       | 2017/06/01 19:31:53 [INFO] Created default configuration file at /etc/hyperledger/fabric-ca-server/fabric-ca-server-config.yaml
        ca.org1.example.com       | Error: Usage: too many arguments.
        ca.org1.example.com       | Usage:
        ca.org1.example.com       |   fabric-ca-server start [flags]

    This can occur if for some reason the cryptographic materials are generated (via rules in Makefile) more than once.
    The solution is to delete the cryptographic materials so they can be regenerated from scratch.  This can be done
    conveniently via the command

        make rm-generated-artifacts

    No explicit command is necessary to regenerate them for running the docker-compose services, as the `make up` command
    will generate them automatically.  However, they can be generated via the command

        make all-generated-artifacts
-   The `.env` file contains the default environment variable values to be used in `docker-compose.yaml`.

## To-Dos

-   Add docker volumes for peers (and orderer?) to persist the blockchain.
-   Change 'init' call to not accept any parameters and initialize an empty 'bank'.  Add a 'create account'
    transaction, and add some calls to it and the existing 'delete account' transaction.  Verify that
    the state is preserved correctly between calls, and that the web server correctly handles existing
    persistent data in its keystore (regarding enrollment).
-   Make a separate directory of artifacts for use by the web server.  There should be a very clear
    demarcation between the artifacts directories for each logical server (e.g. peer, orderer, ca, webserver).
-   Get peer and orderer TLS working.  Currently it fails within the grpc node module in the Orderer.sendBroadcast call.
