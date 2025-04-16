#!/bin/bash
cd ~/sleep-olympics/server
git pull
docker-compose down
docker-compose build --no-cache
docker-compose up -d