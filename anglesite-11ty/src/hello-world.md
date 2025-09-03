---
layout: layout.html
title: Hello World in Top 10 Languages
description: Hello World examples in the most popular programming languages on GitHub
---

This page demonstrates "Hello World" examples in the top 10 most popular programming languages on GitHub, showcasing the syntax highlighting capabilities.

**Note:** To see syntax highlighting with colors, you need to add a Prism.js theme CSS file. Here are the recommended approaches:

## Option 1: npm Package (Recommended)

```bash
# Install prismjs package
npm install prismjs
```

Then choose one approach:

**Manual Copy:**

```bash
cp node_modules/prismjs/themes/prism.css src/_includes/
```

**Auto-Copy (via Eleventy passthrough):**

```js
// In your .eleventy.js config
eleventyConfig.addPassthroughCopy({
  'node_modules/prismjs/themes/prism.css': 'prism.css',
});
```

**Link in your HTML layout:**

```html
<link rel="stylesheet" href="/prism.css" />
```

**Available themes:** `prism.css`, `prism-dark.css`, `prism-okaidia.css`, `prism-tomorrow.css`, `prism-twilight.css`, `prism-funky.css`, `prism-coy.css`, `prism-solarizedlight.css`

## Option 2: Auto-include via Plugin

```js
// Configure plugin to auto-copy CSS
anglesiteEleventy(eleventyConfig, {
  syntaxHighlightOptions: {
    theme: 'dark', // Theme name
    includeCSS: true, // Auto-copy from node_modules
  },
});
```

```html
<!-- Link the auto-copied theme -->
<link rel="stylesheet" href="/prism-dark.css" />
```

## Option 3: CDN

```html
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.30.0/themes/prism.min.css" />
```

## JavaScript

```js
console.log('Hello, World!');
```

## TypeScript

```ts
function sayHello(message: string): void {
  console.log(message);
}

sayHello('Hello, World!');
```

## Python

```python
print("Hello, World!")
```

## Java

```java
public class HelloWorld {
    public static void main(String[] args) {
        System.out.println("Hello, World!");
    }
}
```

## C Sharp

```csharp
using System;

class Program {
    static void Main() {
        Console.WriteLine("Hello, World!");
    }
}
```

## PHP

```php
<?php
echo "Hello, World!";
?>
```

## C++

```cpp
#include <iostream>

int main() {
    std::cout << "Hello, World!" << std::endl;
    return 0;
}
```

## C

```c
#include <stdio.h>

int main() {
    printf("Hello, World!\n");
    return 0;
}
```

## Go

```go
package main

import "fmt"

func main() {
    fmt.Println("Hello, World!")
}
```

## Rust

```rust
fn main() {
    println!("Hello, World!");
}
```
