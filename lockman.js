var http = require('http');
var querystring = require('querystring');
var dbClientObject = require('mysql').Client;

//namespace-emulation object
var lockman = {};

//actions
lockman.actions = {};

//array of transactions, a transaction connects a db connection with an open http response that maintains the connection
lockman.transactions = [];


//calls one of actions based on the url or returns false if an action is not found
lockman.route = function(request, response) {
	console.log('routing '+request.url);
	var uriComponents = request.url.split('/');
	console.log(uriComponents[1]);
	if (typeof lockman.actions[uriComponents[1]] == 'function') {
		console.log('action '+uriComponents[1]+' found');
		request.connection.setTimeout(0);
		if (lockman.actions[uriComponents[1]].apply(lockman, [request, response, uriComponents[2]]) === false)
			return false;
		else
			return true;
	}

	return false;
};

//creates a db client object which opens a database connection
lockman.createDbClient = function() {
	var dbClient = new dbClientObject();
	dbClient.user = 'root';
	dbClient.password = 'humbaba';
	dbClient.database = 'makler';
	dbClient.connect();
	console.log('opened a database connection');
	return dbClient;
}

//returns an error as a http response
lockman.reportError = function(response, error) {
	console.log('error: '+error);
	response.writeHead(200);
	response.end('{"status": "error", "data": "'+error+'"}');
};

//executes an sql query. if a http response object is passed, it is used to return the results as http response
lockman.executeQuery = function(dbClient, query, response) {
	console.log('Executing query.');
	dbClient.query(query, function(error, result) {
		var responseData = {};
		if (error) {
			responseData.status = 'error';
			responseData.data = error;
		}
		else {
			responseData.status = 'ok';
			responseData.data = result;
		}

		if (response) {
			//console.log('returning: '+JSON.stringify(responseData));
			response.writeHead(200);
			response.end(JSON.stringify(responseData));
		}
	});
};

//executes a query on the database. if transactionId is passed, the query is executed as a part of a transaction
lockman.actions.query = function(request, response, transactionId) {
	//ako metod nije post vracamo error
	if (request.method != 'POST') {
		lockman.reportError(response, 'Unexpected request method '+request.method);
		return false;
	}

	var postData = '';
	request.on('data', function(chunk) {
		postData += chunk;
	});
	request.on('end', function() {
		var requestData = querystring.parse(postData);
		console.log('received request data: '+requestData);

		if (typeof requestData.query == 'undefined') {
			lockman.reportError(response, 'No query provided');
			return false;
		}

		//ako je deo transakcije sa
		if (typeof transactionId != 'undefined') {
			if (typeof lockman.transactions[transactionId] == 'undefined') {
				lockman.reportError(response, 'Transaction not found.');
				return false;
			}

			console.log('received query for transaction '+transactionId);

			lockman.executeQuery(lockman.transactions[transactionId].dbClient, requestData.query, response);
		}
		else {
			console.log('received atomic query');
			var tempDbClient = lockman.createDbClient();
			lockman.executeQuery(tempDbClient, requestData.query, response);
			tempDbClient.end();
		}
	});
};

//starts a transaction, returns transaction id as a http response
lockman.actions.start = function(request, response) {
	console.log('starting transaction');
	var newDbClient = lockman.createDbClient();
	var newTransaction = {};
	newTransaction.dbClient = newDbClient;
	var newTransactionId = lockman.transactions.push(newTransaction) - 1;
	lockman.executeQuery(newDbClient, 'START TRANSACTION;');
	var responseObject = {};
	responseObject.status = 'ok';
	responseObject.data = newTransactionId;
	response.writeHead(200);
	response.end(JSON.stringify(responseObject));
};

//commits a transaction
lockman.actions.end = function(request, response, transactionId) {
	console.log('committing transaction '+transactionId);
	if (typeof lockman.transactions[transactionId] == 'undefined') {
		lockman.reportError(response, 'Transaction not found.');
		return false;
	}

	var transaction = lockman.transactions[transactionId];
	lockman.executeQuery(transaction.dbClient, 'COMMIT;', response);
	transaction.dbClient.end();
	if (typeof transaction.maintResponse == 'object') {
		console.log('the transaction was being maintained, closing connection');
		transaction.maintResponse.end();
	}
	lockman.transactions.splice(transactionId, 1);
};

//rolls a transaction back
lockman.actions.cancel = function(request, response, transactionId) {
	console.log('rolling back transaction '+transactionId);
	if (typeof lockman.transactions[transactionId] == 'undefined') {
		lockman.reportError(response, 'Transaction not found.');
		return false;
	}

	var transaction = lockman.transactions[transactionId];
	lockman.executeQuery(transaction.dbClient, 'ROLLBACK;', response);
	transaction.dbClient.end();
	if (typeof transaction.maintResponse == 'object') {
		console.log('the transaction was being maintained, closing connection');
		transaction.maintResponse.end();
	}
	lockman.transactions.splice(transactionId, 1);
};

//maintains a transaction, should be requested by EventSource in the client that maintains the transaction, closes transaction when the connection is closed by the client
lockman.actions.maintain = function(request, response, transactionId) {
	console.log('maintaining transaction '+transactionId);
	if (typeof lockman.transactions[transactionId] == 'undefined') {
		lockman.reportError(response, 'Transaction not found.');
		return false;
	}

	lockman.transactions[transactionId].maintResponse = response;
	response.writeHead(200, {
		'Content-Type': 'text/event-stream',
		'Cache-Control': 'no-cache',
		'Connection': 'keep-alive'
	});
	response.write('id: ' + 'tralala' + '\n');
	console.log('stream started.');

	request.on('close', function() {
		console.log('maintenance stopped by the client, rolling back transaction '+transactionId);
		lockman.actions.cancel(request, response, transactionId);
	});
};

http.createServer(function(request, response) {
	console.log('received request');
	if (!lockman.route(request, response)) {
		console.log('bad request');
		response.writeHead(404);
		response.end();
	}
}).listen(6970);