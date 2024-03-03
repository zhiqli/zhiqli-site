---
title: "一道C语言面试题"
date: 2018-07-30
tags: [c,面试]
---


今天在群里的兄弟分享了一道考察sizeof和strlen的面试题，看似很简单，其实却不然，分析过后，还是有一些不解之处。

- 题目，写出下面代码打印结果

```
char str1[] = "hello";
char str2[5] = {'h','e','l','l','o'};
char str3[6] = {'h','e','l','l','o','\0'};

printf("sizeof(str1) %d\n", (int)sizeof(str1));
printf("strlen(str1) %d\n", (int)strlen(str1));
printf("sizeof(str2) %d\n", (int)sizeof(str2));
printf("strlen(str2) %d\n", (int)strlen(str2));
printf("sizeof(str3) %d\n", (int)sizeof(str3));
printf("strlen(str3) %d\n", (int)strlen(str3));
```

第一眼看，不就是考察sizeof和strlen吗？简单，答案应该是6，5，5，？，6，5。strlen(str2)，what the fuck？
赶紧打开电脑验证一下，结果输出是6，5，5，10，6，5，呐尼？怎么会是10呢？
好吧，既然长度是10，那我就加上一行代码，看看到底是10个什么鬼。


```
for(int i = 0; i < 10; i++)
    printf(" %c", str2[i]);
```

这回打印的结果是h e l l o h e l l o，于是猜想是不是越界到其它变量去了，于是将str1改成"abcde"，再次运行结果是h e l l o a b c d e。
再把str1 str2 str3的内存地址打印出来，依次是504f28a5 504f28a0 504f289a
这回明白了，因为c语言的压栈顺序先定义的变量存在高地址，后定义的在低地址。所以strlen(str2)的时候，实际上是从504f28a0－504f28aa，所以长度为10。
你因为这个问题到这里就结束了吗？其实并没有。刚才是在mac上验证的，gcc的版本是4.2.1。现在我在ubuntu gcc版本为4.3.1验证，打印出来的结果是6，5，5，5，6，5。也就是说strlen(str2)等于5。这又是为什么呢？再次把地址三个变量的地址打印出来，发现每个变量都给分配了16个字节空间，这就说得通了，str2自己后面还有空间，所以就不会越界到其它变量的空间去了。这应该是和编译器内存对齐规则有关了。
所以总结下来正确答案就是6，5，5，不确定，6，5。
