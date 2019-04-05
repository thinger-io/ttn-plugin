'use strict';
angular.module('TTNPlugin', [])
.directive('pluginSettings', function(){
    return {
        restrict: 'EA',
        scope: {
            plugin : '='
        },
        templateUrl: function(){
            let url = document.querySelector("script[src$='ttn-settings.js']");
            return url.src.replace('.js','.html');
        },
        controller: ['$scope', function($scope){

            $scope.plugin.getProperty('settings').then(function(settings) {
                $scope.settings = settings;
            },function error(){
                $scope.settings = {};
                $scope.settings.value = {};
            });

            $scope.plugin.getToken('ttn_plugin_callback').then(function(token) {
                $scope.ttn_plugin_callback = token.access_token;
            },function error(){
                $scope.ttn_plugin_callback = 'Token not found!';
            });

            $scope.save = function(){
                $scope.save_state = 1;
                $scope.plugin.setProperty('settings', $scope.settings).then(function(){
                    $scope.save_state = 2;
                },function(error){
                    $scope.save_state = 3;
                    showError(error);
                });
            };

            function showError(response){
                $scope.error_code = response.status;
                if(response.status<=0){
                    $scope.error_message = "connection refused";
                }else if('data' in response && 'error' in response.data){
                    $scope.error_message = response.data.error.message;
                }else{
                    $scope.error_message = 'unknown';
                }
            }
        }]
    }
});