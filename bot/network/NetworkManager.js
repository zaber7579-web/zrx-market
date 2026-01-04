const dns = require('dns').promises;
const { promisify } = require('util');
const { exec } = require('child_process');
const execAsync = promisify(exec);
const net = require('net');

/**
 * NetworkManager - Network testing utilities
 * 
 * ⚠️ WARNING: This module is for EDUCATIONAL PURPOSES ONLY.
 * Only use on networks and devices you own or have explicit permission to test.
 * Unauthorized network testing is ILLEGAL and can result in severe consequences.
 * 
 * Based on helperwifi bot functionality for legitimate network stress-testing.
 */
class NetworkManager {
  constructor() {
    this.activeTests = new Map(); // Track active tests per user
    this.maxConcurrentTests = 3; // Limit concurrent tests per user
  }

  /**
   * Check if user has permission to run network tests
   * Override this method to add permission checks
   */
  async hasPermission(userId, guildId) {
    // Default: allow all users (you should restrict this in production)
    // Consider checking for admin/moderator roles
    return true;
  }

  /**
   * Ping a host (ICMP ping)
   * Note: Requires appropriate permissions on the system
   */
  async ping(host, count = 4) {
    try {
      // Validate host
      if (!host || typeof host !== 'string') {
        throw new Error('Invalid host');
      }

      // Sanitize host input
      const sanitizedHost = host.replace(/[^a-zA-Z0-9.\-:]/g, '');
      
      // Use system ping command
      const command = process.platform === 'win32' 
        ? `ping -n ${count} ${sanitizedHost}`
        : `ping -c ${count} ${sanitizedHost}`;
      
      const { stdout, stderr } = await execAsync(command, { timeout: 10000 });
      
      if (stderr) {
        throw new Error(stderr);
      }

      // Parse ping results
      const lines = stdout.split('\n');
      const stats = {
        host: sanitizedHost,
        packets: count,
        success: false,
        avgTime: null,
        minTime: null,
        maxTime: null,
        packetLoss: 100
      };

      if (process.platform === 'win32') {
        // Windows ping output parsing
        const packetLossMatch = stdout.match(/(\d+)% loss/);
        const timeMatch = stdout.match(/Average = (\d+)ms/);
        
        if (packetLossMatch) {
          stats.packetLoss = parseInt(packetLossMatch[1]);
          stats.success = stats.packetLoss < 100;
        }
        if (timeMatch) {
          stats.avgTime = parseInt(timeMatch[1]);
        }
      } else {
        // Linux/Mac ping output parsing
        const packetLossMatch = stdout.match(/(\d+)% packet loss/);
        const timeMatch = stdout.match(/min\/avg\/max\/(?:mdev|stddev) = ([\d.]+)\/([\d.]+)\/([\d.]+)/);
        
        if (packetLossMatch) {
          stats.packetLoss = parseInt(packetLossMatch[1]);
          stats.success = stats.packetLoss < 100;
        }
        if (timeMatch) {
          stats.minTime = parseFloat(timeMatch[1]);
          stats.avgTime = parseFloat(timeMatch[2]);
          stats.maxTime = parseFloat(timeMatch[3]);
        }
      }

      return stats;
    } catch (error) {
      throw new Error(`Ping failed: ${error.message}`);
    }
  }

  /**
   * DNS lookup
   */
  async dnsLookup(hostname) {
    try {
      if (!hostname || typeof hostname !== 'string') {
        throw new Error('Invalid hostname');
      }

      const sanitized = hostname.replace(/[^a-zA-Z0-9.\-]/g, '');
      const addresses = await dns.resolve4(sanitized);
      
      return {
        hostname: sanitized,
        addresses: addresses,
        success: true
      };
    } catch (error) {
      // Try IPv6
      try {
        const sanitized = hostname.replace(/[^a-zA-Z0-9.\-]/g, '');
        const addresses = await dns.resolve6(sanitized);
        return {
          hostname: sanitized,
          addresses: addresses,
          success: true,
          ipv6: true
        };
      } catch (err) {
        throw new Error(`DNS lookup failed: ${error.message}`);
      }
    }
  }

  /**
   * Reverse DNS lookup (PTR record)
   */
  async reverseDnsLookup(ip) {
    try {
      if (!ip || typeof ip !== 'string') {
        throw new Error('Invalid IP address');
      }

      const sanitized = ip.replace(/[^0-9.\-:]/g, '');
      const hostnames = await dns.reverse(sanitized);
      
      return {
        ip: sanitized,
        hostnames: hostnames,
        success: true
      };
    } catch (error) {
      throw new Error(`Reverse DNS lookup failed: ${error.message}`);
    }
  }

  /**
   * Test TCP connection to a host and port
   */
  async testConnection(host, port, timeout = 5000) {
    return new Promise((resolve, reject) => {
      if (!host || !port) {
        return reject(new Error('Host and port required'));
      }

      const sanitizedHost = host.replace(/[^a-zA-Z0-9.\-:]/g, '');
      const portNum = parseInt(port);
      
      if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        return reject(new Error('Invalid port number'));
      }

      const socket = new net.Socket();
      let connected = false;
      const startTime = Date.now();

      socket.setTimeout(timeout);

      socket.on('connect', () => {
        connected = true;
        const responseTime = Date.now() - startTime;
        socket.destroy();
        resolve({
          host: sanitizedHost,
          port: portNum,
          success: true,
          responseTime: responseTime,
          message: 'Connection successful'
        });
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve({
          host: sanitizedHost,
          port: portNum,
          success: false,
          responseTime: timeout,
          message: 'Connection timeout'
        });
      });

      socket.on('error', (error) => {
        socket.destroy();
        resolve({
          host: sanitizedHost,
          port: portNum,
          success: false,
          responseTime: Date.now() - startTime,
          message: `Connection failed: ${error.message}`
        });
      });

      socket.connect(portNum, sanitizedHost);
    });
  }

  /**
   * Port scan (limited and rate-limited for safety)
   * ⚠️ WARNING: Only use on systems you own or have permission to test
   */
  async portScan(host, ports, timeout = 2000, delay = 100) {
    try {
      if (!host || !ports) {
        throw new Error('Host and ports required');
      }

      const sanitizedHost = host.replace(/[^a-zA-Z0-9.\-:]/g, '');
      
      // Limit port range for safety
      let portArray = [];
      if (typeof ports === 'string') {
        // Parse port range (e.g., "80-100" or "80,443,8080")
        if (ports.includes('-')) {
          const [start, end] = ports.split('-').map(p => parseInt(p.trim()));
          if (isNaN(start) || isNaN(end) || start < 1 || end > 65535 || end - start > 100) {
            throw new Error('Invalid port range. Max 100 ports at a time.');
          }
          for (let i = start; i <= end; i++) {
            portArray.push(i);
          }
        } else {
          portArray = ports.split(',').map(p => parseInt(p.trim())).filter(p => !isNaN(p) && p > 0 && p <= 65535);
        }
      } else if (Array.isArray(ports)) {
        portArray = ports.filter(p => p > 0 && p <= 65535);
      }

      if (portArray.length === 0 || portArray.length > 100) {
        throw new Error('Invalid ports. Max 100 ports at a time.');
      }

      const results = [];
      
      // Scan ports with delay to avoid overwhelming the target
      for (const port of portArray) {
        const result = await this.testConnection(sanitizedHost, port, timeout);
        results.push(result);
        
        // Rate limiting delay
        if (delay > 0) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }

      return {
        host: sanitizedHost,
        totalPorts: portArray.length,
        openPorts: results.filter(r => r.success).map(r => r.port),
        closedPorts: results.filter(r => !r.success).map(r => r.port),
        results: results
      };
    } catch (error) {
      throw new Error(`Port scan failed: ${error.message}`);
    }
  }

  /**
   * Get network information
   */
  async getNetworkInfo() {
    try {
      const os = require('os');
      const interfaces = os.networkInterfaces();
      
      const info = {
        hostname: os.hostname(),
        platform: os.platform(),
        interfaces: {}
      };

      for (const [name, addresses] of Object.entries(interfaces)) {
        info.interfaces[name] = addresses.map(addr => ({
          address: addr.address,
          netmask: addr.netmask,
          family: addr.family,
          mac: addr.mac,
          internal: addr.internal
        }));
      }

      return info;
    } catch (error) {
      throw new Error(`Failed to get network info: ${error.message}`);
    }
  }

  /**
   * Check if a test is already running for a user
   */
  isTestRunning(userId) {
    return this.activeTests.has(userId) && this.activeTests.get(userId).length >= this.maxConcurrentTests;
  }

  /**
   * Register an active test
   */
  registerTest(userId, testId) {
    if (!this.activeTests.has(userId)) {
      this.activeTests.set(userId, []);
    }
    this.activeTests.get(userId).push(testId);
  }

  /**
   * Unregister a test
   */
  unregisterTest(userId, testId) {
    if (this.activeTests.has(userId)) {
      const tests = this.activeTests.get(userId);
      const index = tests.indexOf(testId);
      if (index > -1) {
        tests.splice(index, 1);
      }
      if (tests.length === 0) {
        this.activeTests.delete(userId);
      }
    }
  }
}

module.exports = NetworkManager;

