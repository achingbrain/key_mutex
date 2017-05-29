var key_mutex = require('../index');

async function delay(ms){
    return await new Promise(function(resolve){
        setTimeout(resolve, ms);
    });
}

async function test(){

    var mutex = key_mutex.mutex();
    
    var waits = [];

    waits.push(mutex.rlock(4, async()=>{
        console.log('A: key = 4, read step 0');
        await delay(50);
        console.log('A: key = 4, read step 1');
        await delay(50);
        console.log('A: key = 4, read step 2');
        await delay(350);
    }));

    waits.push(mutex.rlock(1, async()=>{
        console.log('B: key = 1, read step 0');
        await delay(50);
        console.log('B: key = 1, read step 1');
        await delay(50);
        console.log('B: key = 1, read step 2');
        await delay(50);
    }));

    waits.push((async()=> {
        try{
            await mutex.wlock(3, async()=>{
                console.log('C: key = 3, write step 0');
                await delay(1150);
                console.log('C: key = 3, write step 1');
                throw new Error('I throw an error here!');
                await delay(50);
                console.log('C: key = 3, write step 2');
                await delay(50);
            });
        }catch(err){
            console.log(err);
        }
    })());

    waits.push(mutex.wlock(3, async()=>{
        console.log('D: key = 3, write step 0');
        await delay(50);
        console.log('D: key = 3, write step 1');
        await delay(50);
        console.log('D: key = 3, write step 2');
        await delay(50);
        console.log('D: key = 3, write step 3');
    }));

    waits.push(mutex.wlock(3, async()=>{
        console.log('E: key = 3, write step 0');
        await delay(50);
        console.log('E: key = 3, write step 1');
        await delay(50);
        console.log('E: key = 3, write step 2');
        await delay(50);
        console.log('E: key = 3, write step 3, map size = %d', mutex.size());
    }));

    waits.push(mutex.wlock(4, async()=>{
        console.log('F: key = 4, write step 0');
        await delay(50);
        console.log('F: key = 4, write step 1');
        await delay(50);
        console.log('F: key = 4, write step 2');
        await delay(50);
        console.log('F: key = 4, write step 3, map size = %d', mutex.size());
    }));

    waits.push(mutex.wlock(5, async()=>{
        console.log('G: key = 5, write step 0');
        await delay(50);
        console.log('G: key = 5, write step 1');
        await delay(50);
        console.log('G: key = 5, write step 2');
        await delay(50);
        console.log('G: key = 5, write step 3, map size = %d', mutex.size());
    }));


    waits.push(mutex.rlock(3, async()=>{
        console.log('H: key = 3, read step 0');
        await delay(50);
        console.log('H: key = 3, read step 1');
        await delay(50);
        console.log('H: key = 3, read step 2');
        await delay(50);
        console.log('H: key = 3, read step 3, map size = %d', mutex.size());
    }));

    waits.push(mutex.rlock(1, async()=>{
        console.log('I: key = 1, read step 0');
        await delay(50);
        console.log('I: key = 1, read step 1');
        await delay(50);
        console.log('I: key = 1, read step 2');
        await delay(50);
        console.log('I: key = 1, read step 3, map size = %d', mutex.size());
    }));

    Promise.all(waits).then(function(){
        console.log('finally map size = %d\n', mutex.size());
    });
}

test();
