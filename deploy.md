# Minimal Deployment Guide for Sleep Olympics Backend

This guide covers the essential steps to deploy the Sleep Olympics backend on your Hetzner VPS and set up automatic deployment from GitHub.

## Prerequisites

- Hetzner VPS (running on 157.180.75.112)
- GitHub repository with your Sleep Olympics backend code
- SSH access to the server (pilv@157.180.75.112)

## Step 1: Initial Server Setup

1. SSH into your server:
   ```bash
   ssh pilv@157.180.75.112
   ```

2. Update the system:
   ```bash
   sudo apt update && sudo apt upgrade -y
   ```

3. Install Docker and Docker Compose:
   ```bash
   sudo apt install -y docker.io docker-compose
   ```

4. Add your user to the docker group:
   ```bash
   sudo usermod -aG docker $USER
   ```

5. Log out and log back in for the group changes to take effect:
   ```bash
   exit
   ssh pilv@157.180.75.112
   ```

## Step 2: Application Deployment

1. Create a folder for your application:
   ```bash
   mkdir -p ~/sleep-olympics
   cd ~/sleep-olympics
   ```

2. Clone your repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/sleepBackend.git .
   ```

3. Navigate to the server directory:
   ```bash
   cd server
   ```

4. Create a .env file with all required environment variables:
   ```bash
   nano .env
   ```

5. Add the following environment variables (replace with your actual values):
   ```
   NODE_ENV=production
   PORT=5000
   FIREBASE_SERVICE_ACCOUNT={"your":"firebase","service":"account","json":"here"}
   FIRST_ADMIN_CODE=your_admin_code
   OURA_CLIENT_ID=your_oura_client_id
   OURA_CLIENT_SECRET=your_oura_client_secret
   OURA_REDIRECT_URI=https://your-domain.com/api/auth/oura/callback
   ENCRYPTION_KEY=your_encryption_key
   LOG_LEVEL=info
   ```

6. Start the application with Docker Compose:
   ```bash
   docker-compose up -d
   ```

7. Check if the application is running:
   ```bash
   docker-compose logs -f
   ```

## Step 3: Set Up Automatic Deployments

1. On your server, create an SSH key for GitHub Actions:
   ```bash
   ssh-keygen -t ed25519 -C "github-actions" -f ~/.ssh/github-actions
   ```

2. Add the public key to authorized_keys:
   ```bash
   cat ~/.ssh/github-actions.pub >> ~/.ssh/authorized_keys
   ```

3. Display the private key to add to GitHub secrets:
   ```bash
   cat ~/.ssh/github-actions
   ```

4. Create a deployment script on your server:
   ```bash
   nano ~/sleep-olympics/deploy.sh
   ```

5. Add the following content to deploy.sh:
   ```bash
   #!/bin/bash
   cd ~/sleep-olympics/server
   git pull
   docker-compose down
   docker-compose build --no-cache
   docker-compose up -d
   ```

6. Make the script executable:
   ```bash
   chmod +x ~/sleep-olympics/deploy.sh
   ```

7. In your GitHub repository, go to Settings > Secrets and variables > Actions, and add these secrets:
   - `HOST`: 157.180.75.112
   - `USERNAME`: pilv
   - `SSH_PRIVATE_KEY`: The content of ~/.ssh/github-actions from step 3
   - `ENV_FILE`: The content of your .env file

8. Create a GitHub Actions workflow file in your repository:

Create the directory and file:
```bash
mkdir -p .github/workflows
nano .github/workflows/deploy.yml
```

Add the following content:
```yaml
name: Deploy to Production

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Create .env file
        run: echo "${{ secrets.ENV_FILE }}" > server/.env
        
      - name: Deploy to VPS
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.HOST }}
          username: ${{ secrets.USERNAME }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: ~/sleep-olympics/deploy.sh
```

## Verifying Deployment

Your Sleep Olympics backend should now be accessible directly at:
```
http://157.180.75.112:80
```

To check the application status:
```bash
docker-compose ps
```

To view the logs:
```bash
docker-compose logs -f
```

For any issues, check the logs in ~/sleep-olympics/server/logs/