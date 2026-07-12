'use strict';

const os = require('os');
const crypto = require('crypto');

/**
 * 获取设备详细信息
 */
function getDeviceInfo() {
  let mac = '';
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (!net.internal && net.mac && net.mac !== '00:00:00:00:00:00') {
        mac = net.mac;
        break;
      }
    }
    if (mac) break;
  }

  return {
    hostname: os.hostname(),
    username: os.userInfo().username,
    platform: os.platform(),
    arch: os.arch(),
    mac,
  };
}

/**
 * 基于电脑环境生成稳定的用户标识 ID
 */
function generateDeviceId() {
  const info = getDeviceInfo();
  const parts = [info.hostname, info.username, info.platform, info.arch, info.mac];
  const data = parts.join('|');
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
}

// 缓存
let _deviceId = null;
let _deviceInfo = null;

function getDeviceId() {
  if (!_deviceId) {
    _deviceId = generateDeviceId();
  }
  return _deviceId;
}

function getDevice() {
  if (!_deviceInfo) {
    _deviceInfo = getDeviceInfo();
  }
  return _deviceInfo;
}

module.exports = { getDeviceId, getDevice, generateDeviceId };
