import { addArrayListener, getTracker, toTracked } from "../lib/dependency-tracking.js";

export function testArrayTrackingBasics1() {
    const arr = toTracked([1, 2, 3]);

    console.log(arr.length);

    const tracker = getTracker(arr)!;

    let idx = 0;
    let inserted = 0;
    let deleted = 0;

    tracker[addArrayListener]((arr: number[], a, b, c) => {
        idx = a;
        inserted = b;
        deleted = c;
    });

    arr[1] = 5;

    if (idx !== 1) throw new Error('Expected idx === 1.');
    if (inserted !== 1) throw new Error('Expected inserted === 1.');
    if (deleted !== 1) throw new Error('Expected deleted === 1.');
    if (arr[1] !== 5) throw new Error('Expected arr[1] === 5.');
}

export function testArrayTrackingBasics2() {
    const arr = toTracked([1, 5, 3]);

    console.log(arr.length);

    const tracker = getTracker(arr)!;

    let idx = 0;
    let inserted = 0;
    let deleted = 0;

    tracker[addArrayListener]((arr: number[], a, b, c) => {
        idx = a;
        inserted = b;
        deleted = c;
    });

    arr.splice(2, 1, 6, 7);

    if (idx !== 2) throw new Error('Expected idx === 2.');
    if (inserted !== 2) throw new Error('Expected inserted === 2.');
    if (deleted !== 1) throw new Error('Expected deleted === 1.');
    if (arr[2] !== 6) throw new Error('Expected arr[2] === 6.');
    if (arr[3] !== 7) throw new Error('Expected arr[3] === 7.');
}