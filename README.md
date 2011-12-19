# NodeJS-lockman

A database transaction and lock manager for NodeJS which allows stateless technologies, such as PHP, to maintain and use transactions and locks over more than one http request.

## Usage

The script is simply started by typing 'node lockman.js' in the command line. If it is not started as a daemon, it will send status reports to the console.

By default, the lockman listens to port 6970, but you can edit this at the bottom of the file to any value you may like for your server.

Because lockman is intended to compensate for the statelessness of PHP and similar technologies that rely of http requests to execute scripts, transactions are intended to be maintained by the client. A client can start a transaction by making an AJAX call to http://yourlockmanurl:yourlockmanport/start and it will receive a JSON-encoded object as a response. This object contains a status variable. status == 'ok' means that the transaction has been successfully started and the transaction id can be found in the object's data variable. So, on successful transaction start, the object should look like:
{
	'status': 'ok',
	'data': transactionId
}
where transactionId is an integer.

After starting a transaction, the client should create an EventSource object with url http://yourlockmanurl:yourlockmanport/maintain/transaction_id where transaction_id is the transaction id you received when starting the transaction. The transaction will be maintained as long as the EventSource object keeps the connection open, allowing all benefits of database transactions over any nunber of script executions for the other server-side language. The actions that may used with transactions are:

http://yourlockmanurl:yourlockmanport/query/transaction_id - Runs a query within the specified transaction. Expects a POST request with query parameter containing the query to execute. May be requested without transaction id but will then run the query outside a transaction as if it were run directly on the database, without lockman.

http://yourlockmanurl:yourlockmanport/end/transaction_id - Commits the specified transaction. The maintenance connection opened by client's EventSource will be closed by the server.

http://yourlockmanurl:yourlockmanport/cancel/transaction_id - Rolls the specified transaction back. The maintenance connection opened by client's EventSource will be closed by the server.

The lockman can be easily extending by adding action methods to the lockman.actions object. The router method will by default apply the request object, response object and a single uri component after the module name as arguments of the action method.