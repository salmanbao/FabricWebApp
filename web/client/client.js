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

    $scope.current_account_name     = null;
    $scope.account_context_d        = {};

    $scope.make_account_context     = function (account_name) {
        $scope.account_context_d[account_name] = {
            parent                          : $scope,
            account_name                    : account_name,
            balance                         : null,
            create_account__account_name    : null,
            create_account__initial_balance : null,
            delete_account__account_name    : null,
            transfer__from_account_name     : null,
            transfer__to_account_name       : null,
            transfer__amount                : null,
            query_balance__account_name     : null
        };
    };
    $scope.recompile_account_panel = function (account_name) {
        const account_panel = angular.element(document.getElementById('account_panel'));
        account_panel.attr('context', 'account_context_d["'+account_name+'"]');
        // This nonsense updates the angularjs state based on the changes to the 'context' attribute.
        account_panel.injector().invoke(function($compile){
            $compile(account_panel)(account_panel.scope());
        });
    }
    $scope.bootstrap_account = function (account_name) {
        $scope.append_to_log('bootstrap_account("'+account_name+'");');

        console.assert(!(account_name in Object.keys($scope.account_context_d)), 'Account "'+account_name+'" already exists');
        $scope.make_account_context(account_name);

        $scope.current_account_name = account_name;
        const account_context       = $scope.account_context_d[account_name];
        account_context.balance     = 'N/A';

        $scope.recompile_account_panel(account_name);
    };
    $scope.switch_to_account = function (account_name) {
        $scope.append_to_log('switch_account_panel_to("'+account_name+'");');

        if (!(account_name in Object.keys($scope.account_context_d))) {
            $scope.make_account_context(account_name);
        }

        $scope.current_account_name = account_name;
        const account_context       = $scope.account_context_d[account_name];
//         // Clear old state until the new state is retrieved.
//         account_context.balance = '';

        let promise;
        // Admin doesn't actually have an account in the ledger state, so don't query for it.
        if (account_name == 'Admin') {
            // Make up the response packet that would otherwise be queried
            promise = Promise.resolve({
                response:{
                    data:'N/A'
                }
            });
        }
        // Others have accounts in the ledger state, so query the balance.
        else {
            promise = $scope.query_balance(account_name);
        }
        promise
        .then(response => {
            $scope.append_to_log('response: ' + JSON.stringify(response));
            account_context.balance = response.response.data;
            $scope.recompile_account_panel(account_name);
            $scope.input_account_name = '';
        })
        .catch(err => {
            $scope.append_to_log('error: no account named "' + account_name + '" found (error was ' + err + ').');
            $scope.input_account_name = '';
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

    $timeout(() => {
        $scope.append_to_log('testing');
        $scope.bootstrap_account('Admin');
    });
}])
.directive('accountPanel', () => {
    return {
        scope: {
            context: '=context'
        },
        templateUrl: 'partials/account_panel.html'
    };
});
