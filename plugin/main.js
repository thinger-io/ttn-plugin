const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const API_HOST = process.env.API_HOST;
const ACCESS_TOKEN = process.env.TOKEN_ttn_plugin;
const USER_ID = process.env.USER_ID;

function createDevice(device_id){
    return axios({
        method: 'post',
        url:  `${API_HOST}/v1/users/${USER_ID}/devices`,
        headers: {"Authorization" : `Bearer ${ACCESS_TOKEN}`},
        data: {
            device_id: device_id,
            device_type: 'HTTP',
            device_description: 'Auto provisioned TTN Device'
        }
    });
}

function createBucket(bucket_id){
    return axios({
        method: 'post',
        url:  `${API_HOST}/v1/users/${USER_ID}/buckets`,
        headers: {"Authorization" : `Bearer ${ACCESS_TOKEN}`},
        data: {
            bucket: bucket_id,
            name: bucket_id,
            description: 'Auto provisioned TTN Bucket',
            enabled: true,
            source: 'api'
        }
    });
}

function callDeviceCallback(device_id, payload){
    return axios({
        method: 'post',
        url:  `${API_HOST}/v3/users/${USER_ID}/devices/${device_id}/callback`,
        headers: {"Authorization" : `Bearer ${ACCESS_TOKEN}`},
        data: payload
    });
}

function setDeviceProperties(device_id, properties){
    return axios({
        method: 'post',
        url:  `${API_HOST}/v3/users/${USER_ID}/devices/${device_id}/properties`,
        headers: {"Authorization" : `Bearer ${ACCESS_TOKEN}`},
        data: properties
    });
}

/*
{
   "app_id":"jfmateos_thingerior",
   "counter":2845.0,
   "dev_id":"jfmateos_thingerio_01",
   "downlink_url":"https://integrations.thethingsnetwork.org/ttn-eu/api/v2/down/jfmateos_thingerior/thinger?key=ttn-account-v2.KAKwU66ozqojOX8ygDZoc4QZB4Is7M2kSqVlaGepubI",
   "hardware_serial":"0045687763982140",
   "metadata":{
      "coding_rate":"4/5",
      "data_rate":"SF7BW125",
      "frequency":868.1,
      "gateways":[
         {
            "channel":0.0,
            "gtw_id":"eui-dc4f22ffff583935",
            "latitude":40.41237,
            "longitude":-3.71809,
            "rf_chain":0.0,
            "rssi":-25.0,
            "snr":9.0,
            "time":null,
            "timestamp":2957948451.0
         }
      ],
      "modulation":"LORA",
      "time":"2019-03-15T12:50:22.080690209Z"
   },
   "payload_fields":{
      "analog_in_3":3.3
   },
   "payload_raw":"AwIBSg==",
   "port":1.0
}
*/

function handleUplink(req, res){
    console.log(req.body);
    let device_id = req.body.dev_id;
    callDeviceCallback(device_id, req.body.payload_fields)
    .then(function(response) {
        let properties = [];
        properties.push({property: 'hardware_serial', value: req.body.hardware_serial});
        properties.push({property: 'downlink_url', value: req.body.downlink_url});
        properties.push({property: 'metadata', value: req.body.metadata});
        properties.push({
            property: 'location', value: {
                latitude: req.body.metadata.gateways[0].latitude,
                longitude: req.body.metadata.gateways[0].longitude,
            }
        });
        setDeviceProperties(device_id, properties);
        res.sendStatus(200);
    })
    .catch(function (error) {
        if(error.response){
            // the device does not exists
            if(error.response.status===400){
                createDevice(device_id).then(function(response){
                    createBucket(device_id).then(function (response) {
                        handleUplink(req, res);
                    }).catch(function (error) {

                    });
                }).catch(function (error) {

                });
            }
        }else if (error.request) {
            console.log(error.request);
        } else {
            console.log('Error', error.message);
        }
    });
}

app.post('/uplink', function(req, res) {
    handleUplink(req, res);
});

app.post('/downlink', function(req, res) {

});

app.put('/settings', function(req, res) {

});

app.get('/', function(req, res){
    res.send("ttn-plugin is ready!");
});

app.listen(3000, function () {
    console.log('TTN Plugin is Running!');
    console.log("HOST=" + API_HOST);
    console.log("API_KEY=" + ACCESS_TOKEN);
    console.log("USER_ID=" + USER_ID);
});