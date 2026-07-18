#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
sv-enable crond
sv-enable sshd
cd ~/walkman && nohup python server.py > server.log 2>&1 &
