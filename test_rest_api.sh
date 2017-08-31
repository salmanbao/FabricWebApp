#!/bin/bash -x

# This causes this script to exit with error if any command within this script fails with error.
# https://stackoverflow.com/questions/1378274/in-a-bash-script-how-can-i-exit-the-entire-script-if-a-certain-condition-occurs
set -e

TEMP_DIR=test_rest_api_temporary_files
ACTUAL_OUTPUT=${TEMP_DIR}/actual
EXPECTED_OUTPUT=${TEMP_DIR}/expected
PROTOCOL=http

rm ${TEMP_DIR} -rf
mkdir -p ${TEMP_DIR}

function set_expected_output {
    output=$1
    echo -n "${output}" > ${EXPECTED_OUTPUT}
}

function post {
    url=$1
    curl -X POST "${url}" > ${ACTUAL_OUTPUT}
}

function get {
    url=$1
    curl -X GET "${url}" > ${ACTUAL_OUTPUT}
}

function check_results {
    diff ${ACTUAL_OUTPUT} ${EXPECTED_OUTPUT}
}

function post_and_check_results {
    url=$1
    output=$2
    set_expected_output "${output}"
    post "${url}"
    check_results
    echo -e "\n\n\n"
}

function get_and_check_results {
    url=$1
    output=$2
    set_expected_output "${output}"
    get "${url}"
    check_results
}

# TODO: Make a more complete sequence of tests, testing all transactions, transaction permissions checks, and transaction errors.

get_and_check_results "${PROTOCOL}://localhost:3000/query_balance?invoking_user_name=Admin&account_name=Alice" '{"message":"channel.sendTransactionProposal failed; error(s): chaincode error (status: 500, message: Could not query_balance for account \"Alice\"; error was Could not retrieve account named \"Alice\"; error was GetTableRow failed because row with keys [Alice] does not exist); chaincode error (status: 500, message: Could not query_balance for account \"Alice\"; error was Could not retrieve account named \"Alice\"; error was GetTableRow failed because row with keys [Alice] does not exist); "}'

get_and_check_results "${PROTOCOL}://localhost:3000/query_balance?invoking_user_name=Admin&account_name=Bob" '{"message":"channel.sendTransactionProposal failed; error(s): chaincode error (status: 500, message: Could not query_balance for account \"Bob\"; error was Could not retrieve account named \"Bob\"; error was GetTableRow failed because row with keys [Bob] does not exist); chaincode error (status: 500, message: Could not query_balance for account \"Bob\"; error was Could not retrieve account named \"Bob\"; error was GetTableRow failed because row with keys [Bob] does not exist); "}'

post_and_check_results "${PROTOCOL}://localhost:3000/create_account?invoking_user_name=Admin&account_name=Bob&initial_balance=123" '{"status":"VALID"}'

get_and_check_results "${PROTOCOL}://localhost:3000/query_balance?invoking_user_name=Admin&account_name=Bob" '{"Name":"Bob","Balance":123}'

post_and_check_results "${PROTOCOL}://localhost:3000/create_account?invoking_user_name=Admin&account_name=Alice&initial_balance=456" '{"status":"VALID"}'

get_and_check_results "${PROTOCOL}://localhost:3000/query_balance?invoking_user_name=Admin&account_name=Alice" '{"Name":"Alice","Balance":456}'

post_and_check_results "${PROTOCOL}://localhost:3000/create_account?invoking_user_name=Admin&account_name=Alice&initial_balance=789" '{"message":"Error registering or enrolling \"Alice\""}'

get_and_check_results "${PROTOCOL}://localhost:3000/query_balance?invoking_user_name=Admin&account_name=Alice" '{"Name":"Alice","Balance":456}'

post_and_check_results "${PROTOCOL}://localhost:3000/transfer?invoking_user_name=Admin&from_account_name=Alice&to_account_name=Bob&amount=400" '{"status":"VALID"}'

get_and_check_results "${PROTOCOL}://localhost:3000/query_balance?invoking_user_name=Admin&account_name=Alice" '{"Name":"Alice","Balance":56}'

get_and_check_results "${PROTOCOL}://localhost:3000/query_balance?invoking_user_name=Admin&account_name=Bob" '{"Name":"Bob","Balance":523}'

rm ${TEMP_DIR} -rf

echo "....................................."
echo "all transactions behaved as expected."

