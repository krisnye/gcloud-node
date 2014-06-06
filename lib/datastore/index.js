var conn = require('../common/connection.js'),
    entity = require('./entity.js'),
    Query = require('./query.js').Query,
    util = require('../common/util.js');

var DATASTORE_BASE_URL = 'https://www.googleapis.com/datastore/v1beta2/datasets',
    SCOPES = [
      'https://www.googleapis.com/auth/datastore',
      'https://www.googleapis.com/auth/userinfo.email'],
    MODE_NON_TRANSACTIONAL = 'NON_TRANSACTIONAL',
    MODE_TRANSACTIONAL = 'TRANSACTIONAL';

function Transaction(conn, datasetId) {
  this.conn = conn;
  this.datasetId = datasetId;
  // the default transaction has no id.
  // if id is not set, run operations non-transactional.
  this.id = null;
  this.isFinalized = false;
}

Transaction.prototype.begin = function(callback) {
  var that = this;
  this.makeReq('beginTransaction', null, function(err, resp) {
    if (!err) {
      that.id = resp;
    }
    callback && callback(err);
  });
};

Transaction.prototype.rollback = function(callback) {
  var that = this;
  var req = { transaction: this.id };
  this.makeReq('rollback', req, function(err, resp) {
    that.finalized = !!err;
    callback && callback(err);
  });
};

Transaction.prototype.commit = function(callback) {
  var that = this;
  var req = { transaction: this.id };
  this.makeReq('commit', req, function(err, resp) {
    that.finalized = !!err;
    callback && callback(err);
  });
};

Transaction.prototype.finalize = function(callback) {
  if (!this.finalized) {
    return this.commit(callback);
  }
  callback();
};

Transaction.prototype.get = function(key, callback) {
  this.getAll([key], function(err, keys, objs) {
    if (err || objs.length < 0) {
      return callback(err);
    }
    return callback(null, keys[0], objs[0]);
  });
};

Transaction.prototype.getAll = function(keys, callback) {
  // TODO(jbd): Add transaction support
  keysProto = [];
  keys.forEach(function(k) {
    keysProto.push(entity.keyToKeyProto(this.id, k));
  });
  this.makeReq(
      'lookup', { keys: keysProto }, function(err, resp) {
    if (err) {
      return callback(err);
    }
    var results = [], keys = [];
    resp.found.forEach(function(f) {
      keys.push(entity.keyFromKeyProto(f.entity.key));
      results.push(entity.entityFromEntityProto(f.entity));
    });
    callback && callback(null, keys, results);
  });
};

Transaction.prototype.put = function(key, obj, callback) {
  this.putAll([key], [obj], callback);
};

Transaction.prototype.putAll = function(keys, objs, callback) {
  // TODO(jbd): Add transaction support
  if (keys.length != objs.length) {
    throw new Error('The length of the keys don\'t match the length of the objects');
  }
  var req = {
    mode: MODE_NON_TRANSACTIONAL,
    mutation: {
      update: [],
      insertAutoId: []
    }
  };
  for (var i = 0; i < keys.length; i++) {
    var e = entity.entityToEntityProto(objs[i]);
    e.key = entity.keyToKeyProto(this.id, keys[i]);
    if (entity.isKeyComplete(keys[i])) {
      req.mutation.update.push(e);
    } else {
      req.mutation.insertAutoId.push(e);
    }
  }
  this.makeReq(
      'commit', req, function(err, resp) {
    callback(err, resp);
  });
};

Transaction.prototype.del = function(key, callback) {
  this.delAll([key], callback);
};

Transaction.prototype.delAll = function(keys, callback) {
  // TODO(jbd): Add transaction support
  keysProto = [];
  keys.forEach(function(k) {
    keysProto.push(entity.keyToKeyProto(this.id, k));
  });
  var req = {
    mode: MODE_NON_TRANSACTIONAL,
    mutation: {
      'delete': keysProto
    }
  };
  this.makeReq('commit', req, function(err, resp) {
    callback && callback(err);
  });
};

Transaction.prototype.runQuery = function(q, callback) {
  throw new Error("not implemented");
};

Transaction.prototype.makeReq = function(method, req, callback) {
  // TODO(jbd): Switch to protobuf API.
  this.conn.req({
    method: 'POST',
    uri: DATASTORE_BASE_URL + '/' + this.datasetId + '/' + method,
    json: req
  }, function(err, res, body) {
    if (body && body.error) {
      return callback(body.error, null);
    }
    callback(err, body);
  });
};

/**
 * Creates a new dataset with the provided options.
 * @param {object} opts             Dataset identifier options.
 * @param {string} opts.id          Dataset ID, this is your project ID
 *                                  from Google Developer Console.
 * @param {string} opts.email       Client email of the service account.
 * @param {string} opts.pemFilepath The path to the pem file.
 */
function Dataset(opts) {
  opts = opts || {};
  var id = opts.projectId || '';

  if (id.indexOf("s~") < 0 && id.indexOf("e~") < 0) {
    id = "s~" + id;
  }

  this.id = id;
  this.transaction = new Transaction(new conn.Connection({
    email: opts.email,
    privateKey: opts.pemFilePath,
    scopes: SCOPES
  }), this.id);
}

/**
 * Creates a query from the current dataset to query the specified
 * kinds.
 * @param  {Array<String>} kinds A list of kinds to query.
 * @return {Query}
 */
Dataset.prototype.query = function(kinds) {
  kinds = util.arrayize(kinds);
  kinds = kinds.map(function(val) {
    return { ns: 'default', kind: val };
  });
  return new Query(this.id, kinds);
};

/**
 * Creates a query for collections identified with the specified
 * namespace and kinds.
 *
 * Example usage:
 *   ds.queryNs([{ns: 'zoo', kind: 'Animal' }, {ns: 'test', kind: 'Student'}])
 *
 * @param  {Array<object>} kindAndNamespaces
 * @return {Query}
 */
Dataset.prototype.queryNS = function(nsAndKinds) {
  nsAndKinds = util.arrayize(nsAndKinds);
  return new Query(this.id, nsAndKinds);
};

/**
 * Gets the object identified with the provided key.
 * @param  {Key}        key       A non-incomplete key.
 * @param  {Function}   callback  The callback function.
 */
Dataset.prototype.get = function(key, callback) {
  this.transaction.get(key, callback);
};

Dataset.prototype.getAll = function(keys, callback) {
  this.transaction.getAll(keys, callback);
};

Dataset.prototype.put = function(key, obj, callback) {
  this.transaction.put(key, obj, callback);
};

Dataset.prototype.putAll = function(keys, objs, callback) {
  this.transaction.putAll(keys, objs, callback);
};

Dataset.prototype.del = function(key, callback) {
  this.transaction.del(key, callback);
};

Dataset.prototype.delAll = function(keys, callback) {
  this.transaction.delAll(keys, callback);
};

Dataset.prototype.runQuery = function(q, callback) {
  this.transaction.runQuery(q, callback);
};

Dataset.prototype.runInTransaction = function(fn, callback) {
  var t = new Transaction(this.transaction.conn, this.id);
  var done = function() {
    t.finalize(callback);
  };
  t.begin(function(err, id) {
    if (err) {
      return callback(err);
    }
    fn(t, done);
  });
};

Dataset.prototype.allocateIds = function(incompleteKey, n, callback) {
  if (entity.isKeyComplete(incompleteKey)) {
    throw new Error('An incomplete key should be provided.')
  }
  var incompleteKeys = [];
  for (var i = 0; i < n; i++) {
    incompleteKeys.push(entity.keyToKeyProto(this.id, incompleteKey));
  }
  this.transaction.makeReq(
      'allocateIds', { keys: incompleteKeys }, function(err, resp) {
    if (err) {
      return callback(err);
    }
    var keys = [];
    resp.keys.forEach(function(k) {
      keys.push(entity.keyFromKeyProto(k));
    });
    callback(null ,keys);
  });
};

/**
 * Exports Dataset.
 * @type {Dataset}
 */
module.exports.Dataset = Dataset;