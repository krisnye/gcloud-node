/**
 * Copyright 2015 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

var assert = require('assert');
var concat = require('concat-stream');
var extend = require('extend');
var mockery = require('mockery');
var nodeutil = require('util');
var through = require('through2');

var ServiceObject = require('../../lib/common/service-object.js');
var util = require('../../lib/common/util.js');

function FakeServiceObject() {
  this.calledWith_ = arguments;
  ServiceObject.apply(this, arguments);
}

nodeutil.inherits(FakeServiceObject, ServiceObject);

var utilOverrides = {};
var fakeUtil = Object.keys(util).reduce(function(fakeUtil, methodName) {
  fakeUtil[methodName] = function() {
    var method = utilOverrides[methodName] || util[methodName];
    return method.apply(this, arguments);
  };
  return fakeUtil;
}, {});

describe('Index', function() {
  var Model;
  var model;

  var PREDICTION = {
    projectId: 'project-id',
    createModel: util.noop
  };
  var ID = 'model-id';

  before(function() {
    mockery.registerMock('../common/service-object.js', FakeServiceObject);
    mockery.registerMock('../common/util.js', fakeUtil);

    mockery.enable({
      useCleanCache: true,
      warnOnUnregistered: false
    });

    Model = require('../../lib/prediction/model.js');
  });

  after(function() {
    mockery.deregisterAll();
    mockery.disable();
  });

  beforeEach(function() {
    utilOverrides = {};
    model = new Model(PREDICTION, ID);
  });

  describe('instantiation', function() {
    it('should inherit from ServiceObject', function() {
      var createMethodBound = false;
      var predictionInstance = extend({}, PREDICTION, {
        createModel: {
          bind: function(context) {
            assert.strictEqual(context, predictionInstance);
            createMethodBound = true;
          }
        }
      });

      var model = new Model(predictionInstance, ID);
      assert(model instanceof ServiceObject);

      var calledWith = model.calledWith_[0];

      assert.strictEqual(calledWith.parent, predictionInstance);
      assert.strictEqual(calledWith.baseUrl, '/trainedmodels');
      assert.strictEqual(calledWith.id, ID);
      assert.deepEqual(calledWith.methods, {
        create: true,
        delete: true,
        exists: true,
        get: true,
        getMetadata: true,
        setMetadata: {
          reqOpts: {
            method: 'PUT'
          }
        }
      });

      assert.strictEqual(createMethodBound, true);
    });
  });

  describe('analyze', function() {
    it('should make the correct request', function(done) {
      model.request = function(reqOpts) {
        assert.strictEqual(reqOpts.uri, '/analyze');
        done();
      };

      model.analyze(assert.ifError);
    });

    describe('error', function() {
      var error = new Error('Error.');
      var apiResponse = {};

      beforeEach(function() {
        model.request = function(reqOpts, callback) {
          callback(error, apiResponse);
        };
      });

      it('should exec callback with the error & API response', function(done) {
        model.analyze(function(err, analysis, apiResponse_) {
          assert.strictEqual(err, error);
          assert.strictEqual(analysis, null);
          assert.strictEqual(apiResponse_, apiResponse);
          done();
        });
      });
    });

    describe('success', function() {
      var apiResponse = {
        dataDescription: 'data',
        modelDescription: 'model'
      };

      beforeEach(function() {
        model.request = function(reqOpts, callback) {
          callback(null, apiResponse);
        };
      });

      it('should exec callback with analysis & API response', function(done) {
        model.analyze(function(err, analysis, apiResponse_) {
          assert.ifError(err);
          assert.deepEqual(analysis, {
            data: apiResponse.dataDescription,
            model: apiResponse.modelDescription
          });
          assert.strictEqual(apiResponse_, apiResponse);
          done();
        });
      });

      it('should default to empty analysis objects', function(done) {
        var apiResponseWithoutData = {};

        model.request = function(reqOpts, callback) {
          callback(null, apiResponseWithoutData);
        };

        model.analyze(function(err, analysis) {
          assert.ifError(err);
          assert.deepEqual(analysis.data, {});
          assert.deepEqual(analysis.model, {});
          done();
        });
      });
    });
  });

  describe('createWriteStream', function() {
    it('should wait for the write event to make the request', function(done) {
      model.request = function() {
        setImmediate(done);
        return through();
      };

      var writeStream = model.createWriteStream();
      writeStream.emit('writing');
    });

    it('should make the correct request', function(done) {
      model.request = function(reqOpts) {
        assert.strictEqual(reqOpts.method, 'PUT');
        assert.strictEqual(reqOpts.uri, '');
        assert.deepEqual(reqOpts.headers, {
          accept: 'application/json',
          'content-type': 'application/json'
        });

        setImmediate(done);

        return through();
      };

      var writeStream = model.createWriteStream();
      writeStream.emit('writing');
    });

    it('should re-emit the response from the API request', function(done) {
      var response = {};

      model.request = function() {
        var requestStream = through();
        setImmediate(function() {
          requestStream.emit('response', response);
        });
        return requestStream;
      };

      var writeStream = model.createWriteStream();
      writeStream.on('response', function(resp) {
        assert.strictEqual(resp, response);
        done();
      });
      writeStream.emit('writing');
    });

    describe('request stream handling', function() {
      var requestStream;
      var writeStream;

      beforeEach(function() {
        model.request = function() {
          requestStream = concat();
          return requestStream;
        };

        writeStream = model.createWriteStream();
        writeStream.emit('writing');
      });

      it('should re-emit the response', function(done) {
        var response = {};

        writeStream.on('response', function(resp) {
          assert.strictEqual(resp, response);
          done();
        });

        requestStream.emit('response', response);
      });

      it('should cork the write stream on prefinish', function(done) {
        writeStream.on('cork', done);
        requestStream.emit('prefinish');
      });

      describe('handling the response', function() {
        it('should call handle the response on complete event', function(done) {
          var response = {
            body: {}
          };

          utilOverrides.handleResp = function(err, resp, body) {
            assert.strictEqual(err, null);
            assert.strictEqual(resp, response);
            assert.strictEqual(body, response.body);
            done();
          };

          requestStream.emit('complete', response);
        });

        describe('error', function() {
          var error = new Error('Error.');

          beforeEach(function() {
            utilOverrides.handleResp = function(err, resp, body, callback) {
              callback(error);
            };
          });

          it('should destroy the write stream', function(done) {
            writeStream.on('error', function(err) {
              assert.strictEqual(err, error);
              assert.strictEqual(this.destroyed, true);
              done();
            });

            requestStream.emit('complete', {});
          });
        });

        describe('success', function() {
          beforeEach(function() {
            utilOverrides.handleResp = function(err, resp, body, callback) {
              callback();
            };

            // Cork the stream.
            requestStream.emit('prefinish', {});
          });

          it('should uncork the write stream', function() {
            assert.strictEqual(writeStream._corked, 1);
            requestStream.emit('complete', {});
            assert.strictEqual(writeStream._corked, 0);
          });
        });
      });
    });

    describe('pipeline', function() {
      var INPUT = 'hi';
      var LABEL = 'label';

      var pipeline;
      var writeStream;

      var expectedData = JSON.stringify({
        output: LABEL,
        csvInstance: [INPUT]
      });

      beforeEach(function(done) {
        model.request = function() {
          return concat();
        };

        writeStream = model.createWriteStream(LABEL);
        var setPipeline = writeStream.setPipeline;
        writeStream.setPipeline = function(pipeline_) {
          setPipeline.apply(writeStream, arguments);
          pipeline = pipeline_;
          done();
        };
        writeStream.emit('writing');
      });

      it('should use an encoded through stream', function() {
        var throughStream = pipeline[0];
        assert.strictEqual(throughStream._readableState.encoding, 'utf-8');
      });

      it('should properly stringify the input', function(done) {
        var jsonStream = pipeline[1];

        jsonStream.pipe(concat(function(dataWritten) {
          assert.strictEqual(dataWritten, expectedData);
          done();
        }));

        writeStream.end(INPUT);
      });

      it('should send all data to the request stream', function(done) {
        var requestStream = pipeline[2];

        writeStream.on('cork', function() {
          writeStream.uncork();
        });

        writeStream.on('finish', function() {
          setImmediate(function() {
            var requestBody = requestStream.body.join('');
            assert.strictEqual(requestBody, expectedData);
            done();
          });
        });

        writeStream.end(INPUT);
      });
    });
  });

  describe('query', function() {
    it('should make the correct request', function(done) {
      var input = 'input';

      model.request = function(reqOpts) {
        assert.strictEqual(reqOpts.method, 'POST');
        assert.strictEqual(reqOpts.uri, '/predict');
        assert.deepEqual(reqOpts.json, {
          input: {
            csvInstance: [input]
          }
        });
        done();
      };

      model.query(input, assert.ifError);
    });

    describe('error', function() {
      var error = new Error('Error.');
      var apiResponse = {};

      beforeEach(function() {
        model.request = function(reqOpts, callback) {
          callback(error, apiResponse);
        };
      });

      it('should exec callback with error & API response', function(done) {
        model.query('input', function(err, results, apiResponse_) {
          assert.strictEqual(err, error);
          assert.strictEqual(results, null);
          assert.strictEqual(apiResponse_, apiResponse);
          done();
        });
      });
    });

    describe('success', function() {
      var apiResponse = {
        outputLabel: 'label',
        outputMulti: [
          {
            score: '0.00000'
          },
          {
            score: '1.00000'
          }
        ]
      };

      beforeEach(function() {
        model.request = function(reqOpts, callback) {
          callback(null, apiResponse);
        };
      });

      it('should return the results sorted by score', function(done) {
        model.query('input', function(err, results) {
          assert.ifError(err);

          assert.strictEqual(results.winner, apiResponse.outputLabel);

          assert.strictEqual(results.scores.length, 2);

          assert.strictEqual(results.scores[0].score, 1);
          assert.strictEqual(results.scores[1].score, 0);

          done();
        });
      });

      it('should return the outputValue as the winner', function(done) {
        var apiResponseWithValue = extend({}, apiResponse, {
          outputValue: 44
        });

        delete apiResponseWithValue.outputLabel;

        model.request = function(reqOpts, callback) {
          callback(null, apiResponseWithValue);
        };

        model.query('input', function(err, results) {
          assert.ifError(err);
          assert.strictEqual(results.winner, apiResponseWithValue.outputValue);
          done();
        });
      });

      it('should execute callback with API response', function(done) {
        model.query('input', function(err, results, apiResponse_) {
          assert.ifError(err);
          assert.strictEqual(apiResponse_, apiResponse);
          done();
        });
      });
    });
  });

  describe('train', function() {
    it('should should set metadata', function(done) {
      var label = 'label';
      var input = 'input';

      model.setMetadata = function(metadata, callback) {
        assert.strictEqual(metadata.output, label);
        assert.deepEqual(metadata.csvInstance, [input]);
        callback(); // done()
      };

      model.train(label, input, done);
    });
  });
});
