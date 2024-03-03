---
title: "shell脚本变量作用域"
date: 2019-04-26
tags: [shell,笔记]
---


今天写一个shell脚本遇到一个问题，脚本为实现从文件中按行读取，拼接成一个字符串。大概代码如下

```
content=""
cat ./file | while read line
do
    content=$content"-"$line
    echo $content
done
echo $content
```

执行发现打印出来循环中打印了正确结果，而最后一个echo结果却是空。按道理content是全局变量，不会存在作用域的问题。在网上搜了一下发现其中奇妙之处。
关键在这句`cat ./file | while read line`这里用了管道符，管道符非linux内建命令，shell执行非内建命令时会重建子进程来运行，而shell中即使全局变量的作用域也是在本进程中。所以运行完while read line content的修改对于父进程无效。
解决这个问题可以采用另外一种循环读取文本内容的方法，即

```
content=""
while read line
do
    content=$content"-"$line
    echo $content
done < ./file
echo $content
```

使用内置命令重定向符，完美解决问题。
以后对于其他非内建命令的使用也要注意，别踩坑。
