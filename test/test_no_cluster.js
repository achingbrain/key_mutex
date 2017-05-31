var cluster = require('cluster');
var key_mutex = require('../index');
//var key_mutex = require('key_mutex');

var mutex = key_mutex.mutex();
var DELAY_MS = 1;
var TASKS_PER_PROCESS = 100;

function delay(ms){
    return new Promise(function(resolve){
        if(ms == 0) setImmediate(resolve);
        else setTimeout(resolve, ms);
    });
}

function worker_id(){
    return 'worker ' + (cluster.isMaster ? 0 : cluster.worker.id);
}


/* Test 1 - "reader-writer" mutex without nemed key.  */
var ex1_call_count = 0;

async function ex1_task_a(){
    return mutex.rlock(async function(){
        ++ex1_call_count;
        var value = await get_value();
        value.a += 1;
        value.b += 2;
        value.c = value.a + value.b;
        var c = value.c;
        //console.log(`${worker_id()}, ex1_task_a, reader step 1`);
        await delay(DELAY_MS);
        //console.log(`${worker_id()}, ex1_task_a, reader step 2, =======`);
        await set_value(value);
        await delay(DELAY_MS);
        var value = await get_value();
        if(value.c < 0){
            console.log(`ex1_task_a, c = ${c}, value.c = ${value.c}`);
            throw new Error('ex1_task_a test failed');
        }
    });
}

async function ex1_task_b(){
    return mutex.wlock(async function(){
        ++ex1_call_count;
        var value = await get_value();
        value.c = -Math.min(value.a, value.b);
        var c = value.c;
        //console.log(`${worker_id()}, ex1_task_b, writer step 1`);
        await delay(DELAY_MS);
        //console.log(`${worker_id()}, ex1_task_b, writer step 2, =======`);
        await set_value(value);
        await delay(DELAY_MS);
        var value = await get_value();
        if(c !== value.c){
            console.log(`ex1_task_b, c = ${c}, value.c = ${value.c}`);
            throw new Error('ex1_task_b test failed');
        }
    });
}

async function test1(){
    var ret = [];
    var tasks = [ex1_task_a, ex1_task_b];

    ex1_call_count = 0;
    var total_tasks = Math.floor(Math.random() * TASKS_PER_PROCESS);
    for(var i = 0; i < total_tasks; ++i){
        var n = Math.floor(Math.random() * tasks.length);
        ret.push(tasks[n]());
    }
    await Promise.all(ret);
    if(ex1_call_count != total_tasks)
        throw new Error('ex1_call_count not match');
}


/* Test 2 - Bind "reader-writer" mutex with a nemed key */
var ex2_call_count = 0;

async function ex2_task_a(key){
    return mutex.rlock(key, async function(){
        ++ex2_call_count;
        var value = await get_value(key);
        value.a += 2;
        value.b += 1;
        value.c = value.a + value.b;
        var c = value.c;
        //console.log(`${worker_id()}, ex2_task_a, key = ${key}, reader step 1`);
        await delay(DELAY_MS);
        //console.log(`${worker_id()}, ex2_task_a, key = ${key}, reader step 2, =======`);
        await set_value(value, key);
        await delay(DELAY_MS);
        var value = await get_value(key);
        if(value.c < 0){
            console.log(`ex2_task_a, c = ${c}, value.c = ${value.c}`);
            throw new Error('ex2_task_a test failed');
        }
    });
}

async function ex2_task_b(key){
    return mutex.wlock(key, async function(){
        ++ex2_call_count;
        var value = await get_value(key);
        value.c = -Math.min(value.a, value.b);
        var c = value.c;

        //console.log(`${worker_id()}, ex2_task_b, key = ${key}, writer step 1`);
        await delay(DELAY_MS);
        //console.log(`${worker_id()}, ex2_task_b, key = ${key}, writer step 2, =======`);
        await set_value(value, key);
        await delay(DELAY_MS);
        var value = await get_value(key);
        if(c !== value.c){
            console.log(`ex2_task_b, c = ${c}, value.c = ${value.c}`);
            throw new Error('ex2_task_b test failed');
        }
    });
}

async function test2(){
    var ret = [];
    var keys = [1234, 5678];
    var tasks = [ex2_task_a, ex2_task_b];

    ex2_call_count = 0;
    var total_tasks = Math.floor(Math.random() * TASKS_PER_PROCESS);
    for(var i = 0; i < total_tasks; ++i){
        var n0 = Math.floor(Math.random() * keys.length);
        var n1 = Math.floor(Math.random() * tasks.length);
        ret.push(tasks[n0](keys[n1]));
    }

    await Promise.all(ret);
    if(ex2_call_count != total_tasks)
        throw new Error('ex2_call_count not match');
}


if (cluster.isMaster) {
    console.log(`Master ${process.pid} is running`);

    var global_value = {
        a: 0,
        b: 0,
        c: 0
    };
    var global_value2 = {
    }
    global_value2[1234] = {
        a: 0,
        b: 0,
        c: 0
    }
    global_value2[5678] = {
        a: 0,
        b: 0,
        c: 0
    }

    function get_value(key){
        if(key !== undefined)
            return global_value2[key];
        else
            return global_value;
    }

    function set_value(value, key){
        if(key !== undefined)
            global_value2[key] = value;
        else
            global_value = value;
    }

}
else{
    throw new Error('only runs without cluster!');
}

(async function main(){  
    var i = 0;
    while(true){
        try{
            var tests = [];
            tests.push(test1());
            tests.push(test2());
            await Promise.all(tests);
            console.log('test ok', i++);
        }catch(err){
            console.log(err);
            break;
        }
    }
})();

