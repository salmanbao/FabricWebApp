# Hyperledger Fabric Alpha-based Sample app using NodeSDK apis

This is a fork of [github.com/ratnakar-asara/Fabric_SampleWebApp]

### Instructions

Clone this repo with the following command.

```
git clone https://github.com/vdods/Fabric_SampleWebApp
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
