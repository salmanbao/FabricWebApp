/*
Copyright IBM Corp. 2016 All Rights Reserved.

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

// Extensive modifications have been made to the original IBM-copyrighted file
// by Victor Dods on behalf of LedgerDomain LLC.

package main


import (
    "crypto/x509"
    "encoding/json"
    "encoding/pem"
    "fmt"
    mspprotos "github.com/hyperledger/fabric/protos/msp"
    pb "github.com/hyperledger/fabric/protos/peer"
    "strconv"
    "strings"
    // NOTE: This is temporarily vendored INSIDE THE github.com/example_cc DIR!
    "github.com/example_cc/golang/protobuf/proto"
    "github.com/example_cc/util"
    "github.com/hyperledger/fabric/core/chaincode/shim"
)

// This code came from advice from Gari Singh
func GetCreatorCert (stub shim.ChaincodeStubInterface) (*x509.Certificate, error) {
    creator, err := stub.GetCreator()
    if err != nil {
        return nil, err
    }
    id := &mspprotos.SerializedIdentity{}
    err = proto.Unmarshal(creator, id)
    if err != nil {
        return nil, err
    }
    block, _ := pem.Decode(id.IdBytes)
    cert, err := x509.ParseCertificate(block.Bytes)
    return cert, err
}

func GetTransactorCommonName (stub shim.ChaincodeStubInterface) string {
    cert, err := GetCreatorCert(stub)
    // I'm just so sick of handling errors.
    if err != nil {
        panic(err)
    }
    return cert.Subject.CommonName
}

func ValidateUserNameFormat (user_name string) error {
    if strings.Contains(user_name, ":") {
        return fmt.Errorf("Invalid user name \"%s\"; may not contain the char ':'", user_name)
    }
    return nil
}

func AdminNameKey () (string, error) {
    return "config::admin", nil
}

func AccountKey (account_name string) (string, error) {
    err := ValidateUserNameFormat(account_name)
    if err != nil {
        return "", err
    }
    return fmt.Sprintf("account::%s", account_name), nil
}

// SimpleChaincode example simple Chaincode implementation
type SimpleChaincode struct {
}

//
// Config related functions
//

const CONFIG_TABLE = "ConfigTable"

// The admin user is the unique privileged user, defined by the transactor for the call to Init, that is allowed
// to invoke all chaincode methods.
type Admin struct {
    Name string `json:"Name"`
}

func set_admin (stub shim.ChaincodeStubInterface, admin *Admin) error {
    var old_admin Admin
    row_was_found,err := util.InsertTableRow(stub, CONFIG_TABLE, []string{"Admin"}, admin, util.DONT_FAIL_UPON_OVERWRITE, &old_admin)
    if err != nil {
        return fmt.Errorf("Error setting %s Admin value to %v; error was %v", CONFIG_TABLE, admin, err.Error())
    }
    if row_was_found && *admin != old_admin {
        fmt.Print("WARNING: Setting Admin to %v, which is different than previous value of %v", admin, old_admin)
    }
    return nil // success
}

// If err is not nil, then admin is nil, and vice versa.
func get_admin (stub shim.ChaincodeStubInterface) (*Admin, error) {
    var admin Admin
    row_was_found,err := util.GetTableRow(stub, CONFIG_TABLE, []string{"Admin"}, &admin, util.FAIL_IF_MISSING)
    if err != nil {
        return nil,fmt.Errorf("Could not retrieve Admin; error was %v", err.Error())
    }
    if !row_was_found {
        return nil,fmt.Errorf("Admin entry in %s not found", CONFIG_TABLE)
    }
    return &admin,nil
}

//
// transactor determining functions
//

func transactor_is (stub shim.ChaincodeStubInterface, common_name string) bool {
    return GetTransactorCommonName(stub) == common_name
}

func transactor_is_admin (stub shim.ChaincodeStubInterface) bool {
    admin,err := get_admin(stub)
    if err != nil {
        return false
    }
    return GetTransactorCommonName(stub) == admin.Name
}

//
// user account related functions
//

const ACCOUNT_TABLE = "AccountTable"

type Account struct {
    Name    string  `json:"Name"`
    Balance int     `json:"Balance"`
}

func row_keys_of_Account (account *Account) []string {
    return []string{account.Name}
}

// Raw form of function which does no permissions checking
func create_account_ (stub shim.ChaincodeStubInterface, account *Account) error {
    var old_account Account
    row_was_found,err := util.InsertTableRow(stub, ACCOUNT_TABLE, row_keys_of_Account(account), account, util.FAIL_BEFORE_OVERWRITE, &old_account)
    if err != nil {
        return err
    }
    if row_was_found {
        return fmt.Errorf("Could not create account %v because an account with that Name already exists", *account)
    }
    return nil // success
}

// Raw form of function which does no permissions checking
func overwrite_account_ (stub shim.ChaincodeStubInterface, account *Account) error {
    _,err := util.InsertTableRow(stub, ACCOUNT_TABLE, row_keys_of_Account(account), account, util.FAIL_UNLESS_OVERWRITE, nil)
    return err
}

// Raw form of function which does no permissions checking
func delete_account_ (stub shim.ChaincodeStubInterface, account_name string) error {
    _,err := util.DeleteTableRow(stub, ACCOUNT_TABLE, []string{account_name}, nil, util.FAIL_IF_MISSING)
    return err
}

// Raw form of function which does no permissions checking
func get_account_ (stub shim.ChaincodeStubInterface, account_name string) (*Account, error) {
    var account Account
    row_was_found,err := util.GetTableRow(stub, ACCOUNT_TABLE, []string{account_name}, &account, util.FAIL_IF_MISSING)
    if err != nil {
        return nil,fmt.Errorf("Could not retrieve account named \"%s\"; error was %v", account_name, err.Error())
    }
    if !row_was_found {
        return nil,fmt.Errorf("Account named \"%s\" does not exist", account_name)
    }
    return &account,nil
}

// Raw form of function which does no permissions checking
func transfer_ (stub shim.ChaincodeStubInterface, from_account_name string, to_account_name string, amount int) error {
    if amount < 0 {
        return fmt.Errorf("Can't transfer a negative amount (%d)", amount)
    }
    from_account,err := get_account_(stub, from_account_name)
    if err != nil {
        return fmt.Errorf("Error in retrieving \"from\" account \"%s\"; %v", from_account_name, err.Error())
    }
    to_account,err := get_account_(stub, to_account_name)
    if err != nil {
        return fmt.Errorf("Error in retrieving \"to\" account \"%s\"; %v", to_account_name, err.Error())
    }
    if from_account.Balance < amount {
        return fmt.Errorf("Can't transfer; \"from\" account balance (%d) is less than transfer amount (%d)", from_account.Balance, amount)
    }

    from_account.Balance -= amount
    to_account.Balance += amount

    err = overwrite_account_(stub, from_account)
    if err != nil {
        return fmt.Errorf("Could not transfer from account %v; error was %v", *from_account, err.Error())
    }

    err = overwrite_account_(stub, to_account)
    if err != nil {
        return fmt.Errorf("Could not transfer to account %v; error was %v", *to_account, err.Error())
    }

    return nil
}

func get_account_names_ (stub shim.ChaincodeStubInterface) ([]string, error) {
    row_json_bytes_channel,err := util.GetTableRows(stub, ACCOUNT_TABLE, []string{}) // empty row_keys to get all entries
    if err != nil {
        return nil, fmt.Errorf("Could not get account names; %v", err.Error())
    }

    var account_names []string
    var account Account
    for row_json_bytes := range(row_json_bytes_channel) {
        err = json.Unmarshal(row_json_bytes, &account)
        if err != nil {
            return nil, fmt.Errorf("Could not get account names; json.Unmarshal of \"%s\" failed with error %v", string(row_json_bytes), err)
        }

        account_names = append(account_names, account.Name)
    }
    return account_names, nil
}

//
// chaincode API functions
//

func (t *SimpleChaincode) Init(stub shim.ChaincodeStubInterface) pb.Response  {
    fmt.Println("########### example_cc Init ###########")
    _, args := stub.GetFunctionAndParameters()
    if len(args) != 0 {
        return shim.Error("Incorrect number of arguments. Expecting 0")
    }

    fmt.Printf("within Init : GetTransactorCommonName(stub): %v\n", GetTransactorCommonName(stub))

    err := set_admin(stub, &Admin{Name:GetTransactorCommonName(stub)})
    if err != nil {
        return shim.Error(fmt.Sprintf("Init failed; %v", err.Error()))
    }

    return shim.Success(nil)
}

func (t *SimpleChaincode) Invoke(stub shim.ChaincodeStubInterface) pb.Response {
    fmt.Println("########### example_cc Invoke ###########")
    function, args := stub.GetFunctionAndParameters()

    fmt.Printf("within Invoke : GetTransactorCommonName(stub): %v\n", GetTransactorCommonName(stub))

    if function == "create_account" {
        // Creates an account with the given name and initial balance.
        return t.create_account(stub, args)
    }
    if function == "delete_account" {
        // Deletes an account.
        return t.delete_account(stub, args)
    }
    if function == "transfer" {
        // Transfers an amount from one account to another.
        return t.transfer(stub, args)
    }
    if function == "query_balance" {
        // Queries an account balance.
        return t.query_balance(stub, args)
    }
    if function == "query_account_names" {
        // Queries all account names.
        return t.query_account_names(stub, args)
    }
    return shim.Error(fmt.Sprintf("Unknown action '%s', check the first argument, must be one of 'create_account', 'delete', 'query_balance', or 'transfer'", function))
}

func (t *SimpleChaincode) create_account (stub shim.ChaincodeStubInterface, args []string) pb.Response {
    if len(args) != 2 {
        return shim.Error("Incorrect number of arguments.  Expecting 2; account_holder_name and initial_balance")
    }

    if !transactor_is_admin(stub) {
        return shim.Error(fmt.Sprintf("Could not create account; transactor \"%s\" is not the registered admin user", GetTransactorCommonName(stub)))
    }

    // Parse and validate the args.
    account_holder_name := args[0]
    initial_balance, err := strconv.Atoi(args[1])
    if err != nil {
        return shim.Error(fmt.Sprintf("Malformed initial_balance string \"%s\"; expecting nonnegative integer", args[1]))
    }
    if initial_balance < 0 {
        return shim.Error(fmt.Sprintf("Invalid initial_balance %v; expecting nonnegative integer", initial_balance))
    }

    err = create_account_(stub, &Account{Name:account_holder_name, Balance:initial_balance})
    if err != nil {
        return shim.Error(err.Error())
    }

    return shim.Success(nil)
}

func (t *SimpleChaincode) transfer (stub shim.ChaincodeStubInterface, args []string) pb.Response {
    if len(args) != 3 {
        return shim.Error("Incorrect number of arguments. Expecting 3; 2 names and 1 value")
    }

    from_account_name := args[0]
    to_account_name := args[1]
    amount, err := strconv.Atoi(args[2])
    if err != nil {
        return shim.Error(fmt.Sprintf("Invalid transaction amount \"%s\", expecting a integer value", args[2]))
    }

    // Admin is allowed to transfer, and the account holder is allowed to transfer.
    if !transactor_is_admin(stub) && !transactor_is(stub, from_account_name) {
        return shim.Error(fmt.Sprintf("User \"%s\" is not authorized to transfer from account \"%s\"", GetTransactorCommonName(stub), from_account_name))
    }

    err = transfer_(stub, from_account_name, to_account_name, amount)
    if err != nil {
        return shim.Error(err.Error())
    }

    return shim.Success(nil);
}

// Deletes the account of the named user.
func (t *SimpleChaincode) delete_account (stub shim.ChaincodeStubInterface, args []string) pb.Response {
    if len(args) != 1 {
        return shim.Error("Incorrect number of arguments. Expecting 1")
    }

    // only Admin is allowed to delete accounts
    if !transactor_is_admin(stub) {
        return shim.Error("Only admin user is not authorized to delete_account")
    }

    account_name := args[0]
    err := delete_account_(stub, account_name)
    if err != nil {
        return shim.Error(err.Error())
    }

    return shim.Success(nil)
}

// Query the balance of an account with specified username.
func (t *SimpleChaincode) query_balance (stub shim.ChaincodeStubInterface, args []string) pb.Response {
    if len(args) != 1 {
        return shim.Error("Incorrect number of arguments. Expecting name of the person to query")
    }

    account_name := args[0]

    // Admin is allowed to query_balance, and the account holder is allowed to query_balance.
    if !transactor_is_admin(stub) && !transactor_is(stub, account_name) {
        return shim.Error(fmt.Sprintf("User \"%s\" is not authorized to query account \"%s\"", GetTransactorCommonName(stub), account_name))
    }

    account,err := get_account_(stub, account_name)
    if err != nil {
        return shim.Error(fmt.Sprintf("Could not query_balance for account \"%s\"; error was %v", account_name, err))
    }

    // Serialize Account struct as JSON
    bytes,err := json.Marshal(account)
    if err != nil {
        return shim.Error(fmt.Sprintf("Serializing account failed in query_balance because json.Marshal failed with error %v", err))
    }
    fmt.Printf("query_balance Response: %s\n", string(bytes))
    return shim.Success(bytes)
}

// Query all account names
func (t *SimpleChaincode) query_account_names (stub shim.ChaincodeStubInterface, args []string) pb.Response {
    if len(args) != 0 {
        return shim.Error(fmt.Sprintf("Incorrect number of arguments. Expecting 0 arguments, got %v", args))
    }

    // only Admin is allowed to query_account_names
    if !transactor_is_admin(stub) {
        return shim.Error("Only admin user is authorized to query_account_names")
    }

    account_names,err := get_account_names_(stub)
    if err != nil {
        return shim.Error(fmt.Sprintf("Could not query_account_names due to error %v", err.Error()))
    }

    var bytes []byte
    if len(account_names) == 0 {
        bytes = []byte("[]")
    } else {
        // Serialize account names as JSON
        bytes,err = json.Marshal(account_names)
        if err != nil {
            return shim.Error(fmt.Sprintf("Serializing account names failed in query_account_names because json.Marshal failed with error %v", err))
        }
    }
    fmt.Printf("query_account_names response: %s\n", string(bytes))
    return shim.Success(bytes)
}

func main() {
    err := shim.Start(new(SimpleChaincode))
    if err != nil {
        fmt.Printf("Error starting Simple chaincode: %s", err)
    }
}
