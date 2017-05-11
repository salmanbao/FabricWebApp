# PHONY targets have no dependencies and they will be built unconditionally.
.PHONY: up up-detached logs-follow down down-full rm-state-volumes rm-node-modules

# Bring up all services (and necessary volumes, networks, etc)
up:
	docker-compose -f artifacts/docker-compose.yaml up --abort-on-container-exit

# Bring up all services (and necessary volumes, networks, etc) in detached mode
up-detached:
	docker-compose -f artifacts/docker-compose.yaml up -d

# Follow the output of the logs
logs-follow:
	docker-compose -f artifacts/docker-compose.yaml logs --follow --tail="all"

# Bring down all services (delete associated containers, networks, but not volumes)
down:
	docker-compose -f artifacts/docker-compose.yaml down

# Bring down all services and volumes (delete associated containers, networks, AND volumes)
down-full:
	docker-compose -f artifacts/docker-compose.yaml down -v

# Delete the "state" volumes -- tmp dir (which contains the webserver's key store) and HFC key/value store in home dir
# This can be done after `make down` to reset things to a "clean state", without needing to recompile go code or
# run `npm install` from scratch.
rm-state-volumes:
	docker volume rm artifacts_webserver_tmp artifacts_webserver_homedir

# Delete the node_modules dir, in case things get inexplicably screwy and you just feel like you have to nuke something.
rm-node-modules:
	docker volume rm artifacts_webserver_homedir_node_modules
