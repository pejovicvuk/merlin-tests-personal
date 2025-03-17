import { CircularBuffer } from "./circular-buffer.js";

export type Task<T> = (arg: T) => void;

const queue = new CircularBuffer<Task<any> | undefined | any>();

let queueStart = 0;
let queueLiving = 0;

let scheduledExecutionId: number | undefined;

export function executeQueuedTasks() {
    while(queue.length > 0) {
        const task = queue.pop() as Task<any>;
        const arg = queue.pop();
        --queueLiving;
        queueStart += 2;

        if (task !== undefined) {
            try {
                task(arg);
            }
            catch(err) {
                console.error(err);
            }
        }
    }

    clearTimeout(scheduledExecutionId);
    scheduledExecutionId = undefined;
}

export function enqueTask<T>(task: Task<T>, arg: T): number {
    const id = queueStart + queue.length;
    queue.push(task);
    queue.push(arg);
    ++queueLiving;
    if (scheduledExecutionId === undefined) {
        scheduledExecutionId = setTimeout(executeQueuedTasks);
    }
    return id;
}

export function cancelTaskExecution(id: number) {
    if (id < queueStart) return;
    if (id >= queueStart + queue.length) throw new Error('Unknown task ID.');

    if (queueStart === id) {
        queue.pop();
        queue.pop();
        queueStart += 2;
    }
    else {
        queue.set(id - queueStart, undefined);
        queue.set(id - queueStart + 1, undefined);
    }

    if (--queueLiving === 0) {
        clearTimeout(id);
        scheduledExecutionId = undefined;

        queueStart += queue.length;
        queue.clear();
    }
}