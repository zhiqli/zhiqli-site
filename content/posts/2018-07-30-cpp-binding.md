---
title: "一道C++绑定面试题展开"
date: 2018-07-30
tags: [c++,面试]
---

> 早上排队进地铁时候看到一个面试题，据说校招社招从来没人做对过。被肉贴肉的人流中看了一眼，不是选B吗。后面细思不对，既然没人做对，必有蹊跷，肯定是一个下意识中一定错的答案。
来到公司，运行一遍。果然选C。

```
#include <stdio.h>

class Test {
public:
    Test(){}
    ~Test(){}

    void f(){
        printf("hello world\n");
    }
};

int main() {
    Test *p = NULL;
    printf("%d\n", p);
    p->f();
    return 0;
}

以上代码运行结果：
A 编译不过
B coredump
C hello world
D 以上都不对
```

仔细分析一下这题目。
在C++中，对于非虚成员函数，是静态绑定的，编译时期绑定函数地址。并且在函数中，没有对this解引用，所以this即使是NULL也不会有问题。
那么还有一个问题来了，既然对象指针都为NULL，那么函数存在哪里呢？
C++里面成员函数，不依赖对象，存储在代码区。在编译期就确定了，调用者空不空都无所谓。

这里涉及到C++中的静态绑定和动态绑定。相关分析有很多文章分析得非常好比如[这篇](http://www.cnblogs.com/lizhenghn/p/3657717.html)