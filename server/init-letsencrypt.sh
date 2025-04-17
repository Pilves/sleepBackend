#!/bin/bash

# This script will set up the initial SSL certificates using Certbot
# Using IP address directly
domains=(157.180.75.112)
email="patricpaidla@gmail.com" # Email for Let's Encrypt notifications
data_path="./certbot"
staging=0 # Set to 1 if you're testing to avoid hitting rate limits

if [ -d "$data_path" ]; then
  read -p "Existing data found. Continue and replace existing certificates? (y/N) " decision
  if [ "$decision" != "Y" ] && [ "$decision" != "y" ]; then
    exit
  fi
fi

# Create directories for certbot
mkdir -p "$data_path/conf/live/$domains"
mkdir -p "$data_path/www"

# Create dummy certificates to start nginx with https
openssl req -x509 -nodes -newkey rsa:4096 -days 1 \
  -keyout "$data_path/conf/live/$domains[0]/privkey.pem" \
  -out "$data_path/conf/live/$domains[0]/fullchain.pem" \
  -subj "/CN=localhost"

echo "Starting nginx..."
docker-compose up -d nginx

# Wait for nginx to start
echo "Waiting for nginx to start..."
sleep 5

# Request real certificates
echo "Requesting Let's Encrypt certificates..."
if [ $staging != "0" ]; then staging_arg="--staging"; fi

docker-compose run --rm --entrypoint "\
  certbot certonly --webroot -w /var/www/certbot \
    $staging_arg \
    --email $email \
    --agree-tos \
    --no-eff-email \
    -d ${domains[0]}" certbot

echo "Reloading nginx..."
docker-compose exec nginx nginx -s reload