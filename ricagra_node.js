/**
FUNCTIONS
*/

function rndBtwn(min, max){
    return Math.floor((Math.random() * max) + min);
}
function simulate_localevent(){
    var exec_time = rndBtwn(0, 500) * 10;
    console.log("+ Local event on ("+macadr+", "+proc_id+") [Execution: "+exec_time+"ms] ...");
    // lets wait
    var stop = new Date().getTime() + exec_time;
    while(stop > new Date().getTime()){}
    // finished execution
    increase_lamport();

}

function sendAcknowledgesToQ(Q, sock){
    for (var i = 0; i < Q.length; ++i) {
        var tmp = JSON.parse(Q.pop());
        var ack = generateAcknowledge(macadr, proc_id, lamport_timestamp, tmp.sender_port);
        sock.send(['ricagra', ack]);
    }
}

function generateClaim(mac_address, proc_id, lamport_tstmp){
    var pkg = new Object();
    pkg.type = 42;
    pkg.mac = mac_address;
    pkg.processid = proc_id;
    pkg.lamport_tstmp = lamport_tstmp;
    pkg.sender_port = node_port;

    return JSON.stringify(pkg);
}

function generateAcknowledge(mac_address, proc_id, lamport_tstmp, recv_port){
    var pkg = new Object();
    pkg.type = 404;
    pkg.mac = mac_address;
    pkg.processid = proc_id;
    pkg.lamport_tstmp = lamport_tstmp;
    pkg.sender_port = node_port;
    pkg.recv_port = recv_port;

    return JSON.stringify(pkg);
}

// lamport actions
function increase_lamport(){
    lamport_timestamp++;
    console.log("  > Lamport Timestamp set from "+(lamport_timestamp-1)+" to "+lamport_timestamp);
}
function max_lamport(tstmpA, tstmpB){
    var ltstmp_before = lamport_timestamp;
    lamport_timestamp = Math.max(tstmpA, tstmpB)+1;
    console.log("  > Lamport Timestamp set from "+ltstmp_before+" to "+lamport_timestamp);
}

/**
MAIN
 */
console.log("> Ricart & Agrawala distributed mutual exclusion algorithm (in Node.js and ZMQ)");

// node ricagra_node.js 2 4000 1
if(process.argv.length != 5){ // no arguments
    console.log("> Scriptusage: \"node script.js number_of_clients port process_id\"");
    return;
}
var num_of_clients = process.argv[2];
var node_port = process.argv[3];
var proc_id = process.argv[4];
var lamport_timestamp = 0;


//console.log("num="+num_of_clients+" nodeport="+node_port+" proc_id="+proc_id);
// command: node script.js <number_of_clients> <port> <process_id>

// fetch the computers mac address
var macadr;
var gm = require('getmac');
gm.getMac(function(err,macAddress){
    if (err)  throw err
    macadr = macAddress;
    // validate
    if (!gm.isMac(macadr) ) {
        macadr = "e4:ce:8f:5b:a7:fc";
    }
    console.log("> Node-ID set to (Machine=\'"+macadr+"\', Process=\'"+proc_id+"\')");
    var isClaiming = false;
    var isInResource = false;
    var sendTimestamp = 0;

    var zmq = require('zmq')
        , sock = zmq.socket('pub');
    var conn_cred = "tcp://127.0.0.1:"+node_port;
    sock.bindSync(conn_cred);
    console.log('> Publisher bound to port '+node_port);
    // subscribe to all the other clients
    for(var i = 0; i < num_of_clients; i++){
        var sub_port = (4000+i).toString();
        // skip the port of this node
        if(sub_port == node_port){ continue; }

        // subscribe
        var zmq = require('zmq'), sockSUBS = zmq.socket('sub');
        var conn_cred = "tcp://127.0.0.1:"+sub_port;
        sockSUBS.connect(conn_cred);
        sockSUBS.subscribe('ricagra');
        console.log("> Subscribed to (localhost, "+sub_port+")");

        var ack_recv = 0;
        var ack_stack = [];

        sockSUBS.on('message', function(topic, message) {

            console.log('< Received a message related to:', topic.toString(), 'containing message:', message.toString());
            var pkg = JSON.parse(message.toString());
            // format  {"type":42,"mac":"44-8A-5B-99-3A-0D","processid":"1","lamport_tstmp":7, "sender_port":4000, "recv_port":4001}

            switch(pkg.type){
                case 42: // claim
                    if(!isInResource){ // case 1 or 2
                        if (!isClaiming) { // case 1  ( not claiming)
                            // The receiver is not interested in the resource, send a reply (OK) to the sender.
                            var ack = generateAcknowledge(macadr, proc_id, lamport_timestamp, pkg.sender_port);
                            sock.send(['ricagra', ack]);
                            console.log("  < [C1] Recv a message and not interested. Sending acknowledge.");

                        } else { // case 2  ( claiming)
                            // The receiver also wants the lock on the resource and has sent its request.
                            // In this case, the receiver compares the timestamp in the received message
                            // with the one in the message that it has sent out. The earliest timestamp wins.
                            // If the receiver is the loser, it sends a reply (OK) to sender. If the receiver
                            // has the earlier timestamp, then it is the winner and does not reply (and will
                            // get an OK from the other process). Instead, it adds the request to its queue and
                            // will send the OK only when it is done with its use of the resource.
                            console.log("  < [C2] Recv a message and claiming aswell.");
                            if(lamport_timestamp > pkg.lamport_tstmp){
                                //console.log("  < [C2] Recv a message and claiming aswell. [Loser] ("+lamport_timestamp+" > "+pkg.lamport_tstmp+")");
                                // loser, send ack
                                var ack = generateAcknowledge(macadr, proc_id, lamport_timestamp, pkg.sender_port);
                                sock.send(['ricagra', ack]);

                            }else{
                                //console.log("  < [C2] Recv a message and claiming aswell. [Winner] ("+lamport_timestamp+" < "+pkg.lamport_tstmp+")");
                                //ack_stack.push(message.toString());
                                ack_recv++;
                                if (ack_recv == (num_of_clients-1)) { // all acks recv > get RESOURCE
                                    isInResource = true;
                                    isClaiming = false;
                                }
                            }
                        }
                    }else { // case 3
                        // The receiver is in the resource. Do not reply but add the request to a local queue of requests.
                        console.log("  < [C3] Recv a message but in resource.");
                        ack_stack.push(message.toString());
                    }
                    max_lamport(lamport_timestamp, pkg.lamport_tstmp);
                    break;
                case 404: // acknowledge
                    if(pkg.recv_port == node_port) { // ack for us?
                        if (isClaiming) { // are we claiming?
                            ack_recv++;
                            if (ack_recv == (num_of_clients-1)) { // all acks recv > get RESOURCE
                                isInResource = true;
                                isClaiming = false;
                            }
                        }

                        max_lamport(lamport_timestamp, pkg.lamport_tstmp);
                    }
                    break;

            }

        });
    }

    // wait 5 sec
    var stop = new Date().getTime() + 5000;
    while(stop > new Date().getTime()){}

    var claim_count = 0;
    setInterval(function(){
        // is in resource?
        if(isInResource){
            console.log("!! In Resource !!");
            simulate_localevent();
            console.log("> Leaving Resource and send acknowledge !!");
            sendAcknowledgesToQ(ack_stack, sock);

            // reset values
            ack_recv = 0;
            ack_stack = [];
            isInResource = false;
            return;
        }

        // waiting for ack?
        if(isClaiming){ return; }

        // NOT in resource or waiting > usual business
        var shouldSimulate = rndBtwn(1,3);
        //console.log(shouldSimulate);
        if(shouldSimulate == 1) {
            simulate_localevent();
        }

        isClaiming = true;


        console.log("> Publishing claim! (Nr. " + (++claim_count) + ")");
        increase_lamport();
        sendTimestamp = lamport_timestamp;
        var claim = generateClaim(macadr, proc_id, lamport_timestamp);
        sock.send(['ricagra', claim]);
        console.log("  > Waiting for acknowledge ...");
    }, 100);

});