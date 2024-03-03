---
title: "一次mysql锁问题排查"
date: 2019-11-15
tags: [mysql,笔记]
---

查了一个线上mysql 锁等待的问题，记录一下以后别犯这么低级的错误

## 背景
线上一个老业务有一个任务状态表，最早的设计是单库单表比较low。由于数据没有迁移，对完成任务也没有删除操作，日积月累导致数据越来越多影响正常业务。用了一个简单的定时脚本每天把一个月前的数据迁移到一个月分历史表中。

* 服务对表的操作流程如下
1. 收到客户端请求，新建任务，insert数据到db。
2. 内部多个服务处理完update state task where id = 'xxx'，每个任务大概会有2-3次update。

* 表结构如下

```
CREATE TABLE IF NOT EXISTS `task` (
  `auto_id` int(11) NOT NULL auto_increment,
  `id` varchar(60) NOT NULL,
  `state` int(11) NOT NULL,
  `create_time` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `update_time` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`auto_id`),
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
```

* 数据迁移脚本如下

```
movesql="insert into task_history_${month} select auto_id,id,state,create_time,update_time from task where update_time < '${monthago}'; "
echo ${movesql} | $mysql
deletesql="delete from task where update_time < '${monthago}';"
echo ${deletesql} | $mysql
```

迁移方法确实比较low，不过也跑了很长一段时间。但是这两天出问题了。


## 问题
具体问题是客户端反馈调用失败率很高，于是在服务端查看问题
1. 查服务端日志发现很多insert，update失败；
2. 查task表中数据一个月前的数据还在，即数据迁移失败。
3. 手动运行数据迁移脚本，运行一段时间后输出日志`Lock wait timeout exceeded; try restarting transaction`。
4. 通过`show engine innodb status;`查看发现以下日志

```
LOCK WAIT 3 lock struct(s), heap size 1136, 2 row lock(s)
MySQL thread id 12377101, OS thread handle 139630459942656, query id 253584314 127.0.0.1 root updating
UPDATE task SET state=1 WHERE id='2234234' and state=0
------- TRX HAS BEEN WAITING 6 SEC FOR THIS LOCK TO BE GRANTED:
RECORD LOCKS space id 2 page no 206509 n bits 600 index idx_gcid of table ``.`task` trx id 536762947 lock_mode X waiting
```

查看了一下上面那个id，发现这个id居然有十几万记录。于是问题一下子就水落石出。

## 真相
从上面的建表语句可以看出auto_id是主键，业务id没有唯一索引。之前跑了这么久没有也确实没问题，因为之前客户端不会对同一个id重复请求。而上个月业务逻辑修改，同一个id会有重复请求。
innodb中默认隔离级别是可重复读，在RR中，对非索引字段的delete和update都会加nextkey lock，由于delete和update数据量都不小，都是长事务，所以会进入锁等待，从而导致超时。

解决也很简单，对id建个唯一索引，update_time建一个普通索引。