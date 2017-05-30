var $ = {};
var cluster = require('cluster');

var index = 0;

var mutexes = new Map();
var callback_message_inited = false;

function Master(){
    var thiz = this;
    thiz.type = 0;
    thiz.index = index++;
    
    if (!cluster.isMaster) return;

    var wait_writer = [];
    var wait_reader = [];
    var status = 0;    //0, no action, 1, reading, 2, writing
    var reading_peers = 0;

    var next = function() {
        //console.log('status ', status);
        if(status == 0
            && wait_writer.length > 0){
            var op = wait_writer.shift();
            status = 2;
            if(op.worker !== undefined)
                op.worker.send({'m_cmd': 'wunlock', 'm_index': thiz.index, 'm_type': thiz.type});
            else
                op.func(thiz.unlock);
        }

        while((status == 0 || status == 1)
            && wait_reader.length > 0){
            var op = wait_reader.shift();
            status = 1;
            reading_peers++;
            if(op.worker !== undefined)
                op.worker.send({'m_cmd': 'runlock', 'm_index': thiz.index, 'm_type': thiz.type});
            else
                op.func(thiz.unlock);
        }
    }
    
    thiz.unlock = function(){
        if(status == 2)
            status = 0;
        else if(status == 1){
            if(reading_peers > 0){
                reading_peers--;
                if(reading_peers == 0)
                    status = 0;
            }
        }
        next();
    }

    if(!callback_message_inited){
        callback_message_inited = true;
        cluster.on('online', function(worker){
            worker.on('message', function(msg) {
                if(msg.m_type !== thiz.type) return;
                
                var mutex = mutexes.get(msg.m_index).master;
                if(mutex === undefined) return;
            
                if(msg.m_cmd === 'next')
                    mutex.unlock();
                else if(msg.m_cmd === 'rlock')
                    mutex.rlock2(worker);
                else if(msg.m_cmd === 'wlock')
                    mutex.wlock2(worker);
            });
        });
    }
    
    thiz.wlock2 = function(worker){
        wait_writer.push({worker: worker});
        next();
    }
    
    thiz.rlock2 = function(worker){
        wait_reader.push({worker: worker});
        next();
    }
    
    thiz.wlock = function(func){
        wait_writer.push({func: func});
        next();
    }
    
    
    thiz.rlock = function(func){
        wait_reader.push({func: func});
        next();
    }
}


function CallbackMutex(){
    var thiz = this;
    thiz.master = new Master();
    var wait_writer = [];
    var wait_reader = [];
    //var status = 0;    //0, no action, 1, reading, 2, writing
    //var reading_peers = 0;

    if(!callback_message_inited){
        callback_message_inited = true;
        process.on('message', (msg) => {
            if(msg.m_type !== thiz.master.type) return;

            var mutex = mutexes.get(msg.m_index);
            if(mutex === undefined) return;

            if(msg.m_cmd === 'wunlock')
                mutex.on_wunlock();
            else if(msg.m_cmd === 'runlock')
                mutex.on_runlock();
        });
    }

    var unlock = function() {
        setImmediate(function(){
            if(cluster.isMaster)
                thiz.master.next();
            else
                process.send({'m_cmd': 'next', 'm_index': thiz.master.index, 'm_type': thiz.master.type});
        });
    }

    thiz.on_wunlock = function(){
        var op = wait_writer.shift();
        op(unlock);
    }

    thiz.on_runlock = function(){
        var op = wait_reader.shift();
        op(unlock);
    }
    
    thiz.wlock = function(func) {
        if(cluster.isMaster)
            thiz.master.wlock(func);
        else{
            wait_writer.push(func);
            process.send({'m_cmd': 'wlock', 'm_index': thiz.master.index, 'm_type': thiz.master.type});
        }
    }

    thiz.rlock = function(func) {
        if(cluster.isMaster)
            thiz.master.rlock(func);
        else{
            wait_reader.push(func);
            process.send({'m_cmd': 'rlock', 'm_index': thiz.master.index, 'm_type': thiz.master.type});
        }
    }
    
    thiz.lock = thiz.wlock;
    
    mutexes.set(thiz.master.index, thiz);
    thiz.destroy = function(){
        mutexes.delete(thiz.master.index);
    }
}


function Mutex() {
    var thiz = this;
    var mutex = new CallbackMutex();
    
    var lock_ = function(func, lock_func) {
        return new Promise(function(resolve, reject){
            lock_func(function(unlock){
                Promise.resolve().then(function(){
                    return func();
                }).then(function(ret){
                    unlock();
                    resolve(ret);
                }, function(err){
                    unlock();
                    reject(err);
                });
            });
        });
    }
    
    thiz.rlock = function(func) {
        return lock_(func, mutex.rlock);
    }
    
    thiz.wlock = function(func) {
        return lock_(func, mutex.wlock);
    }

    thiz.lock = thiz.wlock;
    
    thiz.destroy = function(){
        return mutex.destroy();
    }
}

$.callbackMutex = function() {
    return new CallbackMutex();
}

$.mutex = function() {
    return new Mutex();
}

module.exports = $;
