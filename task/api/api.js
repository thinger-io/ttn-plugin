// configure axios
const axios = require('axios');
let USER = "";
let PLUGIN = "";

module.exports.configure = function(HOST, TOKEN, THINGER_USER, THINGER_PLUGIN){
    axios.defaults.baseURL = 'http://' + HOST;
    axios.defaults.headers.common['Authorization'] = 'Bearer ' + TOKEN;
    axios.defaults.headers.post['Content-Type'] = 'application/json';
    USER = THINGER_USER;
    PLUGIN = THINGER_PLUGIN;
    console.log("configure api with", HOST, TOKEN, USER, PLUGIN);
};

module.exports.createHTTPDevice = async function(deviceId, deviceDescription) {
    console.log(`creating device: ${deviceId}`);
    return axios({
        method: 'post',
        url: `/v1/users/${USER}/devices`,
        data: {
            device: deviceId,
            type: 'HTTP',
            description: deviceDescription
        }
    });
};

module.exports.createBucket = async function(bucketId, bucketName, bucketDescription, config){
    if(config===undefined) config = {source: 'api'};
    console.log(`creating device bucket: ${bucketId}`);
    return axios({
        method: 'post',
        url: `/v1/users/${USER}/buckets`,
        data: {
            bucket: bucketId,
            name: bucketName,
            description: bucketDescription,
            enabled: true,
            config: config
        }
    });
};

module.exports.setDeviceProperties = async function(device_id, properties){
    return axios({
        method: 'post',
        url:  `/v3/users/${USER}/devices/${device_id}/properties`,
        data: properties
    });
};


module.exports.setDeviceCallback = async function (deviceId, actions, properties) {
    console.log(`setting device callback: ${deviceId}`);
    return axios({
        method: 'put',
        url: `/v3/users/${USER}/devices/${deviceId}/callback`,
        data: {
            actions: actions,
            properties: properties
        }
    });
};

module.exports.callDeviceCallback = async function(deviceId, payload, sourceIP, timestamp) {
    console.log(`calling device callback: ${deviceId}`);
    return axios({
        method: payload!==undefined ? 'post' : 'get',
        url: `/v3/users/${USER}/devices/${deviceId}/callback/data`,
        params: {
            ts: timestamp,
            ip: sourceIP
        },
        data: JSON.stringify(payload)
    });
};

module.exports.initializeDownlinkProperty = async function(device_id, donwlink_default){
    let downlink = {};
    downlink[device_id] = {
        downlinkData : donwlink_default
    };
    return setDeviceProperties(device_id, downlink);
};

module.exports.getPluginProperty = async function(propertyId){
    return axios({
        url: `/v1/users/${USER}/plugins/${PLUGIN}/properties/${propertyId}`,
    });
};

module.exports.getDeviceProperty = async function(deviceId, propertyId){
    return axios({
        url: `/v3/users/${USER}/devices/${deviceId}/properties/${propertyId}`,
    });
};

module.exports.setDeviceDownlinkData = async function(deviceId, defaultDownlink){
    console.log(`setting device downlink data: ${deviceId}`);
    let downlink = {
        property: 'downlink',
        value: defaultDownlink
    };
    return module.exports.setDeviceProperties(deviceId, downlink);
};