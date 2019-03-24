const express = require('express');
const request = require('request');
const app = express();

app.use(express.json());

const API_KEY = process.env.THINGER_TOKEN;
const HOST = process.env.THINGER_HOST ? process.env.THINGER_HOST : "localhost";

app.post('/uplink', function(req, res) {

});

app.post('/downlink', function(req, res) {

});

app.listen(3000, function () {
    console.log('TTN Plugin is Running!');
    console.log("HOST=" + HOST);
    console.log("API_KEY=" + API_KEY);
});