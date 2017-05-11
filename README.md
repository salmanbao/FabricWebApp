# Hyperledger Fabric Example App using node.js SDK

This is a fork of https://github.com/ratnakar-asara/Fabric_SampleWebApp

## Instructions

Clone this repo with the following command.

```
git clone https://github.com/vdods/Fabric_SampleWebApp.git
```

In one terminal, spin up the peer network, orderer, certificate authorities, and web server (which hosts the web app).

```
make up
```

Once you see the following in the services log, the web server is ready to process requests.

```
info: ****************** SERVER STARTED ************************
info: **************  http://localhost:4000  ******************
```

In another terminal, execute the test script which issues HTTP requests using `curl` against the REST API offered by the web app.

```
./testAPIs.sh
```

The script should run to completion and exit without error (return code should be 0).

## Finer-grained Instructions

There are several `make` targets that make controlling the docker-compose services defined in `artifacts/docker-compose.yaml`
easier.

The command

```
make up
```

spins up all services and prints all services' logs to the console.  Hitting Ctrl+C in this mode will stop all services.
If any container exits, all will exit.

The command

```
make up-detached
```

spins up all services in the background and does not print logs to the console.  If any container exits, all will exit.

The command

```
make logs-follow
```

can be used voluntarily, in the case that `make up-detached` was used, to follow the services' log printouts.
Hitting Ctrl+C will detach from the log printout but not stop the services.

The command

```
make down
```

brings down all services, but do not delete any volumes (i.e. docker-based persistent storage).

The command

```
make down-full
```

brings down all services and delete all volumes.  This clears all state (of peers, orderer, CAs, web server, etc).

The command

```
make rm-state-volumes
```

deletes the persistent storage of the web server, and can be used for example to reset the web server to a
'clean' state, not having anything in the key/value store(s).  This can be executed only if the services are not up.

The command

```
make rm-node-modules
```

deletes the node_modules directory of the web server (the directory in which the node.js dependencies of
the web server are stored).  This can be executed only if the services are not up.

And finally,

```
make down && make rm-state-volumes && make up
```

is a convenient single command you can use after stopping services to reset all services back to a clean state
and restart them, following the services' logs.  There is typically no need to delete `node_modules` because
it is not likely to qualitatively change or be corrupted (though that does happen sometimes during development
for various reasons).  Note that the web server service in `artifacts/docker-compose.yaml` does execute the
command `npm install`, so any updates to `package.json` should automatically take effect.
