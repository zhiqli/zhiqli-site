---
title: "openrestry body_bytes_sent = 0"
date: 2019-12-17
tags: [network]
---

这是服务从IDC迁移上阿里云过程中遇到的一个问题，虽然定位完成以后发现其实很简单，但也算一个典型的案例。服务是一个openrestry。

## 现象
服务在阿里云部署完以后内部测试通过，切域名。后来收到一个新接入客户端反馈，服务请求失败，也没说具体错误。在服务端这边查看lua中代码逻辑正常执行，但是在nginx access.log中发现很多请求状态返回200，但`body_bytes_sent`为0。

很奇怪，因为这是一个跑了多年的老服务，且让用户请求回IDC机房的服务一切正常。因此感觉可以排除服务问题，猜测是阿里云的问题。

![img](https://user-images.githubusercontent.com/3350002/70974883-cdc31280-20e3-11ea-98ae-67b418663682.png)

![img](https://user-images.githubusercontent.com/3350002/70974966-f2b78580-20e3-11ea-8445-d248ec31eebb.png)

## 抓包分析
首先从服务端抓包
![img](https://user-images.githubusercontent.com/3350002/70974996-06fb8280-20e4-11ea-9f1f-6dc96a3ed0d4.png)

* 223.xxx 是客户端
* 139.xxx 是服务端

可以看到三次握手以后，客户端发送一个post请求，客户端回复ACK。然后就连续收到RST包，由于前面分析了，服务本身没有问题，客户端请求到IDC也正常，所以这个RST是哪里发的呢？

如果能结合客户端一起抓包也许就可以看出这个RST从哪里来的，但协调很麻烦。
还是自力更生先点开客户端POST的数据包看看

![img](https://user-images.githubusercontent.com/3350002/70975240-7cffe980-20e4-11ea-8008-887cbdb4a555.png)

等等，`Host: www.iav98.xyz`这是什么？正常请求的header都需要加密的，这肯定是客户端瞎填的。是否和这个奇怪的header有关呢？

## 验证猜测
在本地验证，发包时header加上这个奇怪的host，并抓包

![img](https://user-images.githubusercontent.com/3350002/70975440-e849bb80-20e4-11ea-9868-44c0628070ce.png)

可以看到三次握手后post请求，收到一个403，WTF？[黑人问号.jpg]，貌似和前面服务端看到的数据包不一样啊？连接也不是客户端断的啊。

点开看个究竟

![img](https://user-images.githubusercontent.com/3350002/70975477-fd264f00-20e4-11ea-93a6-5103d43039f8.png)

里面有一个阿里云的域名`http://batit.aliyun.com/alww.html`

![img](https://user-images.githubusercontent.com/3350002/70975518-0dd6c500-20e5-11ea-9b46-8d5ebd95b0da.png)

至此，问题比较清楚了
1. **请求header的host是未备案的域名，连接被阿里云断了。**
2. **nginx在回包的时候，如果客户端把socket关闭了，就不需要返回包给客户端，`body_bytes_sent`自然就是0了。**

其实这个问题也是客户端懒，如果客户端愿意去看看具体错误，一眼就能看出问题。