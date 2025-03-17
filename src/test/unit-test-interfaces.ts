let nextControlId = 0;

export function createNewElementName() {
    return 'control-' + nextControlId++;
}

export function getNestedHtmlElements(...names: string[]): string {
    let ret = '';
    for (const name of names) {
        ret += '<' + name + '>';
    }

    let x = names.length;
    while(x-- > 0) {
        ret += '</' + names[x] + '>';
    }

    return ret;
}

export type Event = { sender: object, message: string };

let events: Event[] = [];

export function postEvent(sender: object, message: string) {
    events.push({ sender, message });
}

export function getEvent(): Event {
    if (events.length === 0) throw new Error('No events found.');
    const first = events[0];
    events.splice(0, 1);
    return first;
}

export function throwIfHasEvents() {
    if (events.length > 0) throw new Error('Event queue not empty.');
}

export function ensureEventOfType(type: { new(): object }, msg: string) {
    if (events.length === 0) throw new Error('No events found.');
    const ev = events[0];
    if (!(ev.sender instanceof type) || ev.message !== msg) throw new Error(`Expected type ${type.name} - ${ev.message}`);
    events.splice(0, 1);
}

export function ensureEvent(sender: object, msg: string) {
    if (events.length === 0) throw new Error('No events found.');
    const ev = events[0];
    if (ev.sender !== sender || ev.message !== msg) throw new Error(`Expected type ${sender.constructor.name} - ${ev.message}`);
    events.splice(0, 1);
}
