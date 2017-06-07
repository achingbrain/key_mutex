var $ = {};
module.exports = $;


var cluster = require('cluster');
var net = require('net');
var util = require('./util');
var msg_process = require('./msg_process');


var handlers = new Map();
var clients = new Map();

function Client(host, timeout_ms){
    var thiz = this;
    thiz.mutexes = new Map();

    thiz.add = function(name, mutex){
        thiz.mutexes.set(name, mutex);
    }
    thiz.del = function(name){
        thiz.mutexes.delete(name);
        if(thiz.mutexes.size === 0){
            clients.delete(host);
            disconnect_server(host);
        }
    }

    thiz.on_message = function(msg){
        var mutex = thiz.mutexes.get(msg.m_name);
        if(mutex === undefined) return;

        if(msg.m_cmd === 'wlock')
            mutex.on_wlock(msg.m_key);
        else if(msg.m_cmd === 'rlock')
            mutex.on_rlock(msg.m_key);
    }
    
    thiz.send = function(waiter, msg){
        var str = JSON.stringify(msg);
        return connect_server(thiz, host, timeout_ms).then(function(connection){
            if(waiter !== undefined){
                waiter.connection = connection;
                connection.add_waiter(waiter);
            }
            return connection.send(timeout_ms, str);
        });
    }
}

$.get = function(host, timeout_ms){
    var client = clients.get(host);
    if(client === undefined){
        client = new Client(host, timeout_ms);
        clients.set(host, client);
    }
    else{
        if(timeout_ms === undefined) client.timeout_ms = undefined;
        else if(client.timeout_ms !== undefined && client.timeout_ms < timeout_ms)
            client.timeout_ms = timeout_ms;
    } 
    return client;
}



/*
接收数据包格式，18字节
uint8_t     启始标志 0xAA
uint8_t     校验值（亦或）
uint8_t     版本号/包长度（包含启始标志）
uint8_t[]   其他数据
*/

function check_sum(buf, start, end){
    var checksum = 0;
    for(var i = start; i < end; ++i)
        checksum ^= buf[i];
    return checksum;
}

function send_socket_data(timeout_ms, socket, str){
    var buf = Buffer.from(str, 'utf8');
    var header = Buffer.allocUnsafe(3);
    header[0] = 0xAA;
    header[2] = 3 + buf.length;
    buf = Buffer.concat([header, buf]);
    buf[1] = check_sum(buf, 2, buf.length)
    socket.write(buf, 0, buf.length);
}

function parse_socket_data(handler, buf, on_message){
    while(1){
        //寻找启始标志0xAA
        var i = 0;
        for(; i < buf.length; ++i)
            if(buf[i] == 0xAA) break;
        if(i != 0) buf = Buffer.from(buf.slice(i));
        
        //console.log(buf.length)
        
        //校验值
        if(buf.length < 3) break;
        
        //包长度
        var packet_len = buf[2];
         if(buf.length < packet_len) break;
        
        var checksum = check_sum(buf, 2, packet_len);
        if(checksum != buf[1]){
            //校验值失败，移除0xAA，重新寻找启始标志
            buf = Buffer.from(buf.slice(1));
            continue;
        }
        
        //校验值检查成功
        var str = buf.slice(3, packet_len).toString('utf8');
        buf = Buffer.from(buf.slice(packet_len));
        
        var msg = JSON.parse(str);
        on_message(msg);
        //on_recv_socket_data(str);
        //console.log(str);
        //send_socket_data(handler, str);
    }
    return buf;
}

function server_on_create_sock(socket, timeout_ms){
    var Null = {};
    var handler = {};
    handler.closed = false;
    handler.pendings = new Map();

    function close_sock(){
        if(handler.closed) return;
        handler.closed = true;
        handler.force_unlock();
    }

    socket.on('error', close_sock);
    socket.on('end', close_sock);
    socket.on('close', close_sock);
    
    var buf = Buffer.allocUnsafe(0);
    socket.on('data', function (data){
        if(handler.closed) return;
        buf = Buffer.concat([buf, data]);
        buf = parse_socket_data(handler, buf, function(msg){
            if(msg.m_cmd === 'unlock')
                handler.del(msg.m_name, msg.m_key);
            msg_process.on_message(msg, handler);
        });
    });
    
    handler.lock = function(msg){
        if(handler.closed) {
            msg_process.force_unlock(handler, msg.m_name, msg.m_key);
            throw new Error('closed');
        }
       
        //console.log(timeout_ms, typeof msg, msg);
        handler.add(msg.m_name, msg.m_key);
        var str = JSON.stringify(msg);
        send_socket_data(timeout_ms, socket, str);
    }

    handler.force_unlock = function(){
        var pendings = handler.pendings;
        handler.pendings = new Map();
        //console.log(pendings);
        pendings.forEach(function(keys, name){
            var name1 = (name === Null ? undefined : name);
            keys.forEach(function(value, key){
                var key1 = (key === Null ? undefined : key);
                for(var i = 0; i < value.ref_count; ++i){
                    msg_process.force_unlock(handler, name1, key1);
                }
            });
        });
    }

    handler.add = function(name, key){
        if(name === undefined) name = Null;
        if(key === undefined) key = Null;
        //console.log('add', name, key);

        var keys = handler.pendings.get(name);
        if(keys === undefined){
            keys = new Map();
            handler.pendings.set(name, keys);
        }

        var value = keys.get(key);
        if(value === undefined){
            value = {ref_count : 1};
            keys.set(key, value);
        }
        else value.ref_count++;
    }
    handler.del = function(name, key){
        if(name === undefined) name = Null;
        if(key === undefined) key = Null;
        //console.log('del', name, key)

        var keys = handler.pendings.get(name);
        if(keys === undefined) return;

        var value = keys.get(key);
        if(value === undefined) return;

        if(value.ref_count > 0){
            value.ref_count--;
            if(value.ref_count === 0){
                keys.delete(key);
                if(keys.size === 0)
                    handler.pendings.delete(name);
            }
        }
    }
}

function connect_server_once(client, host, timeout_ms){
    return new Promise(function(resolve, reject){
        var handler = handlers.get(host);
        if(handler !== undefined){
            if(handler.connected) resolve(handler);
            else handler.defer_list.add(resolve, reject);
            return;
        }

        var handler = {};
        handler.defer_list = new util.defer_list();
        handler.defer_list.add(resolve, reject);
        handler.waiters = new Set();
        handlers.set(host, handler);

        var connect_args = {};
        var a = host.split(':');

        if(a.length !== 2){
            handler.defer_list.reject('invalid host address');
            return;
        }
        connect_args.host = a[0];
        connect_args.port = parseInt(a[1], 10);
        if(isNaN(connect_args.port)){
            handler.defer_list.reject('invalid host port');
            return;
        }

        var socket = net.connect(connect_args, function(){
            handler.connected = true;
            handler.defer_list.resolve(handler);
            //console.log('server connected');
            //send_socket_data(handler, "12345678");
        });
        
        handlers.socket = socket;

        function close_sock(){
            if(handler.closed) return;
            handler.closed = true;
            handlers.delete(host);
            handler.connected = false;
            handler.defer_list.reject();
            var waiters = handler.waiters;
            handler.waiters = new Set();
            waiters.forEach(function(waiter){
                waiter.done = true;
                waiter.reject(new Error('closed'));
            });
        }

        var buf = Buffer.allocUnsafe(0);
        socket.on('data', function(data){
            buf = Buffer.concat([buf, data]);        
            buf = parse_socket_data(handler, buf, function(msg){
                client.on_message(msg);
            });
        });
        
        handler.send = function(timeout_ms, str){
            //console.log(typeof str, str);
            send_socket_data(timeout_ms, socket, str);
        }

        handler.add_waiter = function(waiter){
            handler.waiters.add(waiter);
        }
        handler.del_waiter = function(waiter){
            handler.waiters.delete(waiter);
        }

        socket.on('end', close_sock);
        socket.on('error', close_sock);
        socket.on('close', close_sock);
    });
}

function connect_server(client, host, timeout_ms){
    var start = process.hrtime();

    return new Promise(function(resolve, reject){
        (function connect(){
            connect_server_once(client, host, timeout_ms).then(function(handler){
                resolve(handler);
            }, function(){
                var diff_ms = util.hrtime(start);
                if(timeout_ms >= 0 && diff_ms >= timeout_ms) reject(new Error('timeout'));
                else{
                    setTimeout(connect, 500);
                }
            });
        })();
    });
}

function disconnect_server(host){
    var handler = handlers.get(host);
    handler.socket.close();
}

$.listen_server = function(port, timeout_ms){
    return new Promise(function(resolve, reject){
        var server = net.createServer(function(socket){
            server_on_create_sock(socket, timeout_ms);
        });

        server.on('error', function(err){
            reject(err);
        });
        server.listen(port, function(){
            //console.log('listening');
            resolve();
        });
    });
}

