import { testArrayTrackingBasics1, testArrayTrackingBasics2 } from './array-tracking-tests.js';
import { testAsyncDemuxBothCancelled, testAsyncDemuxBothCompleted, testAsyncDemuxOneCancelledOneRuns } from './async-tests.js';
import { registerParentAndChild, registerParentThenChild, registerChildThenParent, registerGrandparentAndChildThenParent } from './html-control-core-tests.js';
import { testBasicControl, testModel } from './html-control-tests.js';
import { throwIfHasEvents } from './unit-test-interfaces.js';

const results = document.getElementById('results') as HTMLDivElement;
const playground = document.getElementById('test-playground') as HTMLDivElement;

async function runTest(name: string, test: (playground: HTMLDivElement) => string | undefined | Promise<string | void | undefined> | void) {
    playground.innerHTML = '';

    const div = document.createElement('div');
    div.innerText = name;

    results.appendChild(div);
    try {
        const maybePromise = test(playground);
        const maybeError = maybePromise instanceof Promise ? await maybePromise : maybePromise;
        if (typeof maybeError !== 'string') {
            div.className = 'success';
        }
        else {
            const errorDiv = document.createElement('div');
            errorDiv.innerText = maybeError;
            div.appendChild(errorDiv);
            div.className = 'failure';
        }

        throwIfHasEvents();
    }
    catch(err) {
        const errorDiv = document.createElement('div');
        errorDiv.innerText = '' + err;
        div.appendChild(errorDiv);
        div.className = 'failure';
    }    
}

await runTest('Array tracking', testArrayTrackingBasics1);
await runTest('Array tracking', testArrayTrackingBasics2);
await runTest('Register parent and child.', registerParentAndChild);
await runTest('Register parent then child.', registerParentThenChild);
await runTest('Register child then parent.', registerChildThenParent);
await runTest('Register grandparent and child then parent', registerGrandparentAndChildThenParent);
await runTest('Basic control', testBasicControl);
await runTest('Control model', testModel);

await runTest('Async demux test one aborted, other runs.', testAsyncDemuxOneCancelledOneRuns);
await runTest('Async demux test both aborted', testAsyncDemuxBothCancelled);
await runTest('Async demux test both completed', testAsyncDemuxBothCompleted);

const done = document.createElement('div');
done.innerText = 'Done.'
results.appendChild(done);