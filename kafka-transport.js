'use strict';

var nid = require('nid');

module.exports = function(options) {
  var seneca = this;
  var plugin = 'kafka-transport';
  var listenBus;
  var clientBus;

  if (!seneca.hasplugin('transport')) {
    seneca.use('transport');
  }

  var tu = seneca.export('transport/utils');

  seneca.add({role:'transport',hook:'listen',type:'kafka'}, hookListenQueue);
  seneca.add({role:'transport',hook:'client',type:'kafka'}, hookClientQueue);

  function hookListenQueue(args, done) {
    listenBus = require('microbial')(options.microbial);

    var handlerFn = function(req, res) {
      seneca.act(req.request.act, function(err, result){
        var outmsg = {kind:'res',
                      id:req.request.id,
                      err:err?err.message:null,
                      res:result};
        res.respond(outmsg);
      });
    };
    listenBus.run([{group: options.kafka.group, topicName: options.kafka.requestTopic}],
                  [{ match: { kind: 'act' }, execute: handlerFn}], function(err) {
      if (err) { return console.log(err); }
      seneca.log.info('listen', args.host, args.port, seneca.toString());
      done();
    });
  }

  function hookClientQueue(args, clientdone) {
    var seneca = this;
    var type           = args.type
    var client_options = seneca.util.clean(_.extend({},options[type],args));

    var callmap = {};
    clientBus = require('microbial')(options.microbial);

    tu.make_client( make_send, client_options, clientdone );

    function make_send( spec, topic, send_done ) {

      clientBus.run([{group: options.kafka.group, topicName: options.kafka.responseTopic, responseChannel: true}], [], function(err) {
        if (err) {
          console.log(err);
        }
        else {
          var client = function(args, done) {
            var outmsg = {
              id:   nid(),
              kind: 'act',
              act:  args
            };
            callmap[outmsg.id] = {done:done};
            clientBus.request({topicName: options.kafka.requestTopic}, outmsg, function(res) {
              var call = callmap[res.response.id];
              if( call ) {
                delete callmap[res.response.id];
                call.done(res.response.err ? new Error(res.response.err) : null, res.response.res);
              }
            });
          };
          seneca.log.info('client', 'pubsub', args.host, args.port, seneca.toString());

          send_done( null, function( args, done ) {
            client.call(this, args, done);
          })
        }
      });

    }
  }

  var shutdown = function(args, done) {
    if (listenBus) {
      listenBus.tearDown(function(err) {
        done(err);
      });
    }
    else if (clientBus) {
      clientBus.tearDown(function(err) {
        done(err);
      });
    }
  };

  seneca.add({role:'seneca',cmd:'close'}, shutdown);

  return {
    name: plugin,
  };
};

