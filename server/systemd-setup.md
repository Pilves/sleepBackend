# Setting Up Sleep Olympics API as a SystemD Service
ss
This guide explains how to set up the Sleep Olympics API server as a systemd service for better production reliability and performance.

## Step 1: Copy the service file to systemd

```bash
sudo cp /home/pilv/pro/sleepBackend/server/sleep-olympics.service /etc/systemd/system/
```

## Step 2: Reload systemd and enable the service

```bash
# Reload systemd configurations
sudo systemctl daemon-reload

# Enable the service to start at boot
sudo systemctl enable sleep-olympics.service

# Start the service
sudo systemctl start sleep-olympics.service
```

## Step 3: Check service status

```bash
# Check if the service is running correctly
sudo systemctl status sleep-olympics.service
```

## Common Commands

- **Start the service**: `sudo systemctl start sleep-olympics.service`
- **Stop the service**: `sudo systemctl stop sleep-olympics.service`
- **Restart the service**: `sudo systemctl restart sleep-olympics.service`
- **View logs**: `sudo journalctl -u sleep-olympics.service`
- **View recent logs**: `sudo journalctl -u sleep-olympics.service -n 100 --no-pager`
- **Follow logs in real-time**: `sudo journalctl -u sleep-olympics.service -f`

## Performance Tuning

The service file includes the following performance optimizations:

1. Memory limit set to 3GB
2. CPU quota set to 80% to prevent resource exhaustion
3. Node.js memory limit increased to 2GB
4. ThreadPool size optimized to 4 threads
5. File descriptor limit increased to 4096

To modify these settings, edit the service file at `/etc/systemd/system/sleep-olympics.service` and then run:

```bash
sudo systemctl daemon-reload
sudo systemctl restart sleep-olympics.service
```
