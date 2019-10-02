// initialize environment variables
const HOST = process.env.THINGER_HOST;
const USER = process.env.THINGER_USER;
const PLUGIN = process.env.THINGER_PLUGIN;
const VERSION = process.env.THINGER_PLUGIN_VERSION;
const TOKEN = process.env.THINGER_TOKEN_TTN_PLUGIN;
const DEVELOPMENT = process.env.THINGER_PLUGIN_DEVELOPMENT==='1';

// configure express
const express = require('express');
const app = express();
app.use(express.json({strict: false}));
app.enable('trust proxy');

// initialize development options
if(DEVELOPMENT){
    // configure log-timestamp
    require('log-timestamp');

    // allow CORS
    const cors = require('cors');
    app.use(cors({origin: '*'}));

    // add access control headers
    app.use(function(req, res, next) {
        res.header("Access-Control-Allow-Origin", "*");
        res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
        next();
    });

    // serve static files fro plugin root
    app.use(express.static('../'));

    // create a local tunnel for serving plugin files without installing on a server
    let localtunnel = require('localtunnel');

    let tunnel = localtunnel(3000, {'subdomain': 'ttn-plugin'}, function(err, tunnel) {
        if(!err){
            console.log("local tunnel running at: %s", tunnel.url);
        }else{
            console.error(err);
        }
    });

    tunnel.on('close', function() {
        console.error("tunnel closed, restart app!");
    });
}

// get and configure thinger.io api
const thinger = require('./api/api.js');
thinger.configure(HOST, TOKEN, USER, PLUGIN);

// configure vm2 for running payload processing
const {NodeVM, VMScript} = require('vm2');
const vm = new NodeVM({
    console: 'inherit',
    sandbox: {},
    timeout: 1000,
    require: {
        external: true
    }
});

// running variables
let settings = {};

function getDeviceType(deviceType){
    return (deviceType && deviceType!=='') ? deviceType : 'Default';
}

function getSettings(deviceType){
    return settings[deviceType] || settings['Default'];
}

function getDeviceId(deviceId, settings){
    return settings.device_id_prefix ? settings.device_id_prefix + deviceId : deviceId;
}

function getBucketId(deviceId, settings){
    return settings.bucket_id_prefix ? settings.bucket_id_prefix + deviceId : deviceId;
}

function getDeviceTimeout(settings){
    return settings.device_connection_timeout ? settings.device_connection_timeout : 10;
}

function getDefaultDownlink(settings){
    return settings.device_downlink_data ? JSON.parse(settings.device_downlink_data) : {};
}

function compileCallback(deviceType){
    console.log("compiling callback for device type:", deviceType);

    let settings = getSettings(deviceType);

    // precompile custom callback script
    if(settings && settings.callback_processing && settings.callback_code!=='') {
        try{
            settings.script = vm.run(settings.callback_code);
            console.log("compiled callbacks :", Object.keys(settings.script));
        }catch (err) {
            console.error('callback disabled. failed to compile script:', err.message);
            settings.script = undefined;
            return err;
        }
    }else{
        console.log('device type without callbacks:', deviceType);
        settings.script = undefined;
    }
    return true;
}

function compileCallbacks(stopOnError) {
    for (let deviceType in settings) {
        let result = compileCallback(deviceType);
        if(result!==true && stopOnError===true){
            return {'message' : 'invalid callback code on device type: ' + deviceType + " > " + result.message};
        }
    }
    return true;
}

function run_callback(data, callback, deviceType){
    let settings = getSettings(deviceType);
    if(!settings || data===undefined || settings.script===undefined || settings.script[callback]===undefined) return data;
    try {
        console.log('running callback: ' + callback + ' for: ' + deviceType);
        let result =  settings.script[callback](data);
        console.log('converted data:', JSON.stringify(result));
        return result;
    } catch (err) {
        console.error('failed to execute ' + callback + ' script.', err);
        return data;
    }
}

function handelDeviceCallbackRequest(res, deviceId, deviceType, payload, sourceIP, timestamp) {
    console.log("handling device callback:", deviceId, "deviceType:", deviceType, "payload:", payload, "sourceIP:", sourceIP, "timestamp:", timestamp);
    handleDeviceCallback(deviceId, deviceType, payload, sourceIP, timestamp)
        .then(function(response) {
            if(response.data){
                res.status(response.status).send(response.data);
            }else{
                res.sendStatus(response.status);
            }
        })
        .catch(function(error) {
            console.error(error);
            if(error.response && error.response.status){
                res.status(error.response.status).send(error.response.data);
            }else{
                res.status(500).send(error);
            }
        });
}

async function updateDeviceProperties(deviceId, payload, settings){
    let properties = [];

    // device data
    properties.push({property: 'device', value: {
        app_id : payload.app_id,
        dev_id : payload.dev_id,
        hardware_serial: payload.hardware_serial,
        port: payload.port,
        counter: payload.counter,
        downlink_url: payload.downlink_url
    }});

    // metadata
    if (settings.save_metadata) {
        properties.push({property: 'metadata', value: payload.metadata});
    }

    // device location
    if (settings.update_device_location) {
        properties.push({
            property: 'location', value: {
                latitude: payload.metadata.gateways[0].latitude,
                longitude: payload.metadata.gateways[0].longitude,
            }
        });
    }

    // set device properties (if any)
    if (properties.length > 0) {
        return thinger.setDeviceProperties(deviceId, properties)
                .then((response) => {})
                .catch((error) => {
                    console.error("cannot set device properties:", error);
                });
    }

    return Promise.resolve();
}

async function getDeviceDownlinkData(deviceId, submitData){
    return new Promise(function (resolve, reject) {
        if(Object.keys(submitData).length === 0 && submitData.constructor === Object){
            console.log("getting device downlink data");
            // return the downlink data in the device property
            thinger.getDeviceProperty(deviceId, 'downlink').then((response) => {
                let data = response.data.value;
                console.log('got device downlink data:', JSON.stringify(data));
                resolve(data);
            }).catch((error) => {
                console.error(error);
                reject(error);
            });
        }
        else{
            console.log('using device downlink data:', submitData);
            // return the payload found in the query
            resolve(submitData);
        }
    });
}

function getTTNDownlinkData(deviceId, ttnDevice, confirmed, payload){

    let downlink = {
        dev_id: ttnDevice.dev_id,
        port: ttnDevice.port,
        confirmed: confirmed === 'true'
    };

    let data = run_callback(payload, 'downlink', ttnDevice.app_id);

    if(data===undefined){
        // send nothing
        downlink.payload_raw = "";
    }else if(typeof data==='string'){
        // base64 encoded data
        downlink.payload_raw = data;
    }else{
        // a generic object that contains fields
        downlink.payload_fields = data;
    }

    return downlink;
}

async function handleDeviceCallback(deviceId, deviceType, payload, sourceIP, timestamp) {
    return new Promise(function (resolve, reject) {

        let settings = getSettings(deviceType);

        // device type not defined
        if(!settings) return reject({response: {status:400, data: {message: "device type '" + deviceType + "' has not been defined"}}});

        // set device id based on prefix
        let realDeviceId = getDeviceId(deviceId, settings);

        // get data
        let insert_data = payload.payload_fields ? run_callback(payload.payload_fields, 'uplink', deviceType) : run_callback(payload.payload_raw, 'uplink', deviceType);

        // call device callback with payload fields
        thinger.callDeviceCallback(realDeviceId, insert_data, sourceIP, timestamp)
            .then((response) => {
                updateDeviceProperties(realDeviceId, payload, settings)
                    .then(() => { resolve(response); })
                    .catch((error) => { reject(error); } )
            })
            .catch(function (error) {
                // device is not yet created?
                if (payload!==undefined && (error.response && error.response.status===404)) {

                    // no auto provision
                    if (!settings.auto_provision_resources) return reject(error);

                    // create device, bucket, and set callback
                    let realBucketId = getBucketId(deviceId, settings);
                    thinger.createHTTPDevice(realDeviceId, 'Auto provisioned TTN Device')
                        .then(() => thinger.createBucket(realBucketId, realBucketId, 'Auto provisioned TTN Bucket', {source: 'api'}))
                        .then(() => thinger.setDeviceCallback(realDeviceId, {write_bucket: realBucketId}, {timeout: getDeviceTimeout(settings)}))
                        .then(() => updateDeviceProperties(realDeviceId, payload, settings))
                        .then(() => thinger.callDeviceCallback(realDeviceId, insert_data, sourceIP, timestamp))
                        .then((response) => { resolve(response); })
                        .catch((error) => { reject(error) });
                } else {
                    reject(error);
                }
            });
    });
}

app.post('/uplink', function (req, res) {
    console.log("calling uplink callback url: " + req.originalUrl);

    // get timestamp
    let ts = new Date(req.body.metadata.time);
    let timestamp = ts.getTime() || 0;

    // get application id
    let deviceType = getDeviceType(req.body.app_id);

    // get device Id
    let deviceId = req.body.dev_id;

    // process payload
    let payload = req.body;

    // handle request
    handelDeviceCallbackRequest(res, deviceId, deviceType, payload, req.ip, timestamp);
});

/**
 * Issues a new downlink request over TTN for the provided Thinger.io deviceID.
 * This method will follow the following logic:
 * 1. Get device information stored from previous uplink: TTN device id, app_id, port, etc.
 * 2. Get Downlink data from 'downlink' device property, or from the one submitted in the request.
 * 3. Process this data over the downlink callback (if defined).
 * 4. Submit request to TTN
 */
app.post('/downlink/:deviceId([0-9a-zA-Z_]+)', function (req, res) {
    console.log("calling downlink callback url: " + req.originalUrl);
    let deviceId = req.params.deviceId;
    thinger.getDeviceProperty(deviceId, 'device')
        .then((response) => {
            let device = response.data.value;
            console.log('got device property:', JSON.stringify(device));
            getDeviceDownlinkData(deviceId, req.body)
                .then((data) => {
                    let ttnData = getTTNDownlinkData(deviceId, device, req.query.confirmed, data);
                    console.log("ttn downlink payload:", JSON.stringify(ttnData));
                    console.log("sending request to ttn at:", device.downlink_url);
                    const axios = require('axios');
                    axios({
                        method: 'post',
                        url: device.downlink_url,
                        data: ttnData
                    }).then((result) => {
                        console.log('downlink call succeed!');
                        return res.status(result.status).send(result.data);
                    }).catch((error) => {
                        console.error('downlink call error!', error);
                        return res.status(error.status).send(error);
                    })
                }).catch((error) => {
                    return res.status(500).send({error: {message: 'device data not found in server'}});
                });
        })
        .catch((error) => {
            console.error(error);
            return res.status(error.response.status).send({error: {message: 'cannot get ttn device property'}});
        });
});

app.post('/run_callback', function (req, res) {
    // get callback type
    let fn =  req.query.fn ? req.query.fn : 'uplink';

    console.log('running callback:', fn);

    // get device type
    let deviceType = getDeviceType(req.query.deviceType);

    try {
        let settings = getSettings(deviceType);
        if(settings && settings.script && settings.script[fn]){
            res.json(settings.script[fn](req.body));
        }else{
            res.status(500).send({error: {message: 'script or function ' + fn + ' not defined'}});
        }

    } catch (err) {
        console.error('failed to execute script.', err);
        res.status(500).send({error: {message: err.message}});
    }
});

app.put('/settings', function (req, res) {
    console.log("updating settings: ");
    settings = req.body;
    console.log(JSON.stringify(settings));
    let result = compileCallbacks(true);
    return result===true ? res.sendStatus(200) : res.status(400).send({error:{message: result.message}});
});

app.listen(3000, function () {
    console.log('TTN Plugin is now running with the following configuration:');
    console.log("HOST=" + HOST);
    console.log("TOKEN=" + TOKEN);
    console.log("USER=" + USER);
    console.log("PLUGIN=" + PLUGIN);
    console.log("VERSION=" + VERSION);
    console.log("DEVELOPMENT=" + DEVELOPMENT);

    thinger.getPluginProperty('settings').then(function (response) {
        settings = response.data.value;
        console.log("read existing settings:",JSON.stringify(settings));
        compileCallbacks();
    }).catch(function (error) {
        console.error("plugin settings not available");
        settings = {
            'Default' : {
                auto_provision_resources : true
            }
        };
    });
});