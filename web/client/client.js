/*
Copyright LedgerDomain LLC 2017 All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

         http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

'use strict';

function assemble_url (function_name, req) {
    let url = '/'+function_name+'?';
    const req_keys = Object.keys(req);
    for (var i = 0; i < req_keys.length; i += 1) {
        var key = req_keys[i];
        var value = req[key];
        if (value === undefined) {
            value = '';
        }
        url += key+'='+value;
        if (i+1 < req_keys.length) {
            url += '&';
        }
    }
    return url;
}

angular
.module('app', [])
.controller('controller', ['$scope', '$http', '$timeout', '$window', function($scope, $http, $timeout, $window) {
    $window.scope = $scope;

    $scope.log_content = '';
    $scope.append_to_log = text => {
        $scope.log_content += '-- ';
        $scope.log_content += text;
        $scope.log_content += '\n';
        const log_textarea = document.getElementById('log_textarea');
        // This causes the log to scroll to the bottom (almost).
        log_textarea.scrollTop = log_textarea.scrollHeight;
        console.log(text);
    };

    $scope.post = function (function_name, req) {
        const url = assemble_url(function_name, req);
        const transaction_description = function_name + ' ' + JSON.stringify(req);
        $scope.append_to_log('POST ' + transaction_description);
        return $http.post(url)
        .then(response => {
            $scope.append_to_log('POST ' + transaction_description + ' succeeded: ' + JSON.stringify(response.data));
            return {
                'transaction_description'   :transaction_description,
                'url'                       :url,
                'response'                  :response
            };
        }, response => {
            $scope.append_to_log('POST ' + transaction_description + ' failed: ' + JSON.stringify(response.data));
            throw {
                'transaction_description'   :transaction_description,
                'url'                       :url,
                'response'                  :response
            };
        });
    };
    $scope.get = function (function_name, req) {
        const url = assemble_url(function_name, req);
        const transaction_description = function_name + ' ' + JSON.stringify(req);
        $scope.append_to_log('GET ' + transaction_description);
        return $http.get(url)
        .then(response => {
            $scope.append_to_log('GET ' + transaction_description + ' succeeded: ' + JSON.stringify(response.data));
            return {
                'transaction_description'   :transaction_description,
                'url'                       :url,
                'response'                  :response
            };
        }, response => {
            $scope.append_to_log('GET ' + transaction_description + ' failed: ' + JSON.stringify(response.data));
            throw {
                'transaction_description'   :transaction_description,
                'url'                       :url,
                'response'                  :response
            };
        });
    };

    $scope.create_account = function (invoking_user_name, account_name, initial_balance) {
        return $scope.post('create_account', {invoking_user_name:invoking_user_name, account_name:account_name, initial_balance:initial_balance});
    };
    $scope.delete_account = function (invoking_user_name, account_name) {
        return $scope.post('delete_account', {invoking_user_name:invoking_user_name, account_name:account_name});
    };
    $scope.transfer = function (invoking_user_name, from_account_name, to_account_name, amount) {
        return $scope.post('transfer', {invoking_user_name:invoking_user_name, from_account_name:from_account_name, to_account_name:to_account_name, amount:amount});
    };
    $scope.query_balance = function (invoking_user_name, account_name) {
        return $scope.get('query_balance', {invoking_user_name:invoking_user_name, account_name:account_name});
    };
    $scope.query_account_names = function (invoking_user_name) {
        return $scope.get('query_account_names', {invoking_user_name:invoking_user_name});
    };
    $scope.clear_input_fields = function () {
        $scope.create_account__invoking_user_name = null;
        $scope.create_account__account_name = null;
        $scope.create_account__initial_balance = null;

        $scope.delete_account__invoking_user_name = null;
        $scope.delete_account__account_name = null;

        $scope.transfer__invoking_user_name = null;
        $scope.transfer__from_account_name = null;
        $scope.transfer__to_account_name = null;
        $scope.transfer__amount = null;

        $scope.query_balance__invoking_user_name = null;
        $scope.query_balance__account_name = null;

        $scope.query_account_names__invoking_user_name = null;
    }

    $timeout(() => {
        $scope.append_to_log('Web client started');
    });
}]);
