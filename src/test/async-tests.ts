import { AsyncDemux, AsyncDemuxState, sleepAsync } from "../lib/algorithms.js";

async function sleepAndReturn<T>(result: T, ms: number, signal?: AbortSignal) {
    await sleepAsync(ms, signal);
    return result;
}

export async function testAsyncDemuxOneCancelledOneRuns() {
    let demuxDone = 0;
    let five = 0;

    const ac = new AbortController();
    const get5Async = sleepAndReturn(5, 100, ac.signal);
    const demux = new AsyncDemux(get5Async, ac, (state: AsyncDemuxState, result: any) => {
        ++demuxDone;
        if (state === AsyncDemuxState.Completed) {
            five = result!;
        }
    });

    const ac1 = new AbortController();
    const c1 = demux.addCaller(ac1.signal);
    const ac2 = new AbortController();
    const c2 = demux.addCaller(ac2.signal);

    await sleepAsync(10);
    ac1.abort();

    try {
        await c1;
        throw "Expected c1 to throw."
    }
    catch {
    }

    const fiveAsync = await c2;

    if (fiveAsync !== 5) throw "Expected an async five.";
    if (five !== 5) throw "Expected a five";
    if (demuxDone !== 1) throw "Expected demux to be 1."
}

export async function testAsyncDemuxBothCancelled() {
    let demuxDone = 0;

    const ac = new AbortController();
    const get5Async = sleepAndReturn(5, 6000000, ac.signal);
    const demux = new AsyncDemux(get5Async, ac, () => ++demuxDone);

    const ac1 = new AbortController();
    const c1 = demux.addCaller(ac1.signal);
    const ac2 = new AbortController();
    const c2 = demux.addCaller(ac2.signal);

    await sleepAsync(10);
    ac1.abort();
    ac2.abort();

    try {
        await c1;
        throw "Expected c1 to throw."
    }
    catch {
    }

    try {
        await c2;
        throw "Expected c1 to throw."
    }
    catch {
    }

    try {
        await get5Async;
        throw "Expected get5Async to throw";
    }
    catch {
    }

    if (demuxDone !== 1) throw "Expected demux to be done."
}

export async function testAsyncDemuxBothCompleted() {
    let demuxDone = 0;
    let five = 0;

    const ac = new AbortController();
    const get5Async = sleepAndReturn(5, 100, ac.signal);
    const demux = new AsyncDemux(get5Async, ac, (state: AsyncDemuxState, result: any) => {
        ++demuxDone;
        if (state === AsyncDemuxState.Completed) {
            five = result;
        }
    });

    const ac1 = new AbortController();
    const c1 = demux.addCaller(ac1.signal);
    const ac2 = new AbortController();
    const c2 = demux.addCaller(ac2.signal);

    await sleepAsync(10);

    if (await c1 !== 5) throw "Expected c1 to be 5";
    if (await c2 !== 5) throw "Expected c1 to be 5";
    if (await get5Async !== 5) throw "Expected get5Async to be 5";
    if (five !== 5) throw "Expected five to be 5.";
    if (demuxDone !== 1) throw "Expected demux to be 1.";
}
