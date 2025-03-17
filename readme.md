# Merlin

Merlin is a library of UI [web components](https://developer.mozilla.org/en-US/docs/Web/API/Web_components) that support data binding. The data binding is very sophisticated and efficient, implemented using [proxies](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy).

In practice, that means that you get a set of new tags that  automatically reflect and update your model. For example, the following three tags:

```html
<check-box checked="this.redAndBlue">Red and Blue</check-box>
<check-box checked="this.red">Red</check-box>
<check-box checked="this.blue">Blue</check-box>
```

give you three check boxes:

 ![Checkboxes](/docs/checkboxes.png)

 These checkboxes are in turn controlled by the following model code:

 ```typescript
 class DemoModel {
    // ...

    red = true;
    blue = false;

    get redAndBlue() {
        return this.red === this.blue ? this.red : undefined;
    }

    set redAndBlue(val: boolean | undefined) {
        if (val === undefined) return;

        this.red = this.blue = val;
    }
 }
```

This implements the model for the red, blue and 'red and blue' tri-state checkbox. Note that there is no need to tell the UI when something changes - our proxy observer handles that, including the automatic update of the redAndBlue property when either red or blue fields are changed.

## Installation

Merlin is available as a public NPM package @trilogyes/merlin. To install it execute:

```bash
npm install @trilogyes/merlin
```

or if you are using yarn:

```bash
yarn add @trilogyes/merlin
```