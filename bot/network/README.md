# 🌐 Network Testing Module (helperwifi)

Network testing utilities integrated from the helperwifi bot functionality.

## ⚠️ IMPORTANT WARNING

**This module is for EDUCATIONAL PURPOSES ONLY.**

- Only use on networks and devices you **OWN** or have **EXPLICIT PERMISSION** to test
- Unauthorized network testing is **ILLEGAL** and can result in severe consequences
- You are **RESPONSIBLE** for all actions taken with this code
- This is intended for:
  - Proof-of-Concept testing
  - Educational purposes
  - Stress-testing your own networks
  - Testing DDoS protection on your own infrastructure

## 📋 Available Commands

### `/network ping <host> [count]`
Ping a host using ICMP (Internet Control Message Protocol).
- **host**: IP address or domain name
- **count**: Number of packets to send (1-10, default: 4)

**Example:**
```
/network ping google.com 4
/network ping 8.8.8.8
```

### `/network dns <hostname>`
Perform a DNS lookup to resolve a hostname to IP addresses.
- **hostname**: Domain name to lookup

**Example:**
```
/network dns google.com
/network dns github.com
```

### `/network reverse-dns <ip>`
Perform a reverse DNS lookup (PTR record) to get hostname from IP.
- **ip**: IP address to lookup

**Example:**
```
/network reverse-dns 8.8.8.8
/network reverse-dns 1.1.1.1
```

### `/network test-connection <host> <port> [timeout]`
Test a TCP connection to a specific host and port.
- **host**: IP address or domain name
- **port**: Port number (1-65535)
- **timeout**: Timeout in milliseconds (1000-10000, default: 5000)

**Example:**
```
/network test-connection google.com 80
/network test-connection 192.168.1.1 443 3000
```

### `/network port-scan <host> <ports> [timeout] [delay]`
Scan multiple ports on a host (limited to 100 ports for safety).
- **host**: IP address or domain name
- **ports**: Port range or list (e.g., "80-100" or "80,443,8080")
- **timeout**: Timeout per port in milliseconds (1000-5000, default: 2000)
- **delay**: Delay between ports in milliseconds (50-500, default: 100)

**Example:**
```
/network port-scan localhost 80-100
/network port-scan 192.168.1.1 80,443,8080
```

### `/network info`
Get network information about the server running the bot.
- Shows hostname, platform, and network interfaces

## 🔒 Safety Features

1. **Rate Limiting**: Maximum 3 concurrent tests per user
2. **Port Scan Limits**: Maximum 100 ports per scan
3. **Input Sanitization**: All inputs are sanitized to prevent injection
4. **Timeout Protection**: All operations have timeouts to prevent hanging
5. **Delay Between Scans**: Port scans include delays to avoid overwhelming targets

## 🛠️ Technical Details

- Built with Node.js native modules (`dns`, `net`, `child_process`)
- Cross-platform support (Windows, Linux, macOS)
- Error handling and validation for all inputs
- Educational warnings displayed to users

## 📝 Notes

- Ping functionality requires appropriate system permissions
- Some network operations may be blocked by firewalls or security policies
- Results may vary based on network configuration and permissions
- Port scanning is rate-limited and includes delays for responsible use

## ⚖️ Legal Disclaimer

This software is provided "as is" for educational purposes only. The authors and contributors are not responsible for any misuse or damage caused by this code. Users are solely responsible for ensuring their use complies with all applicable laws and regulations.

