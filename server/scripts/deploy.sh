#!/bin/bash
cd ~/pro/sleepBackend
git pull
cd server
docker-compose down
docker-compose build --no-cache
docker-compose up -d