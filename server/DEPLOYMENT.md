# Sleep Olympics API Deployment Guide

This guide explains how to deploy the Sleep Olympics API with HTTPS using NGINX and Let's Encrypt certificates.

## Prerequisites

- A server with Docker and Docker Compose installed
- A domain name pointing to your server
- Ports 80 and 443 open on your server

## Deployment Steps

1. **Clone the repository to your server**

   ```bash
   git clone <your-repo-url>
   cd sleepBackend/server
   ```

2. **Configure your domain**

   Edit the following files and replace `yourdomain.com` with your actual domain:
   
   - `nginx.conf`
   - `init-letsencrypt.sh`

3. **Set up environment variables**

   Create a `.env` file with your environment variables:
   
   ```bash
   cp .env.example .env
   nano .env
   ```
   
   Add the required environment variables.

4. **Initialize SSL certificates**

   Run the initialization script to set up Let's Encrypt SSL certificates:
   
   ```bash
   ./init-letsencrypt.sh
   ```

5. **Start the services**

   ```bash
   docker-compose up -d
   ```

6. **Verify the deployment**

   Test your API with HTTPS:
   
   ```bash
   curl https://yourdomain.com/api/health
   ```

## Maintenance

- Certificates will automatically renew every 12 hours if needed
- To update the application, pull the latest changes and restart:

  ```bash
  git pull
  docker-compose down
  docker-compose up -d --build
  ```

## Troubleshooting

- Check NGINX logs: `docker-compose logs nginx`
- Check API logs: `docker-compose logs api`
- Check Certbot logs: `docker-compose logs certbot`

If there are issues with certificates:

1. Ensure your domain points to the server's IP
2. Make sure ports 80 and 443 are open
3. Try running init-letsencrypt.sh again

## Security Notes

- All HTTP traffic is automatically redirected to HTTPS
- HTTPS uses secure TLS 1.2/1.3 protocols and strong ciphers
- Security headers are added by default