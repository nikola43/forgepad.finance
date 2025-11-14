-- MySQL dump 10.13  Distrib 8.0.43, for Linux (x86_64)
--
-- Host: localhost    Database: ethism
-- ------------------------------------------------------
-- Server version	8.0.43-0ubuntu0.22.04.2

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `admins`
--

DROP TABLE IF EXISTS `admins`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `admins` (
  `id` int NOT NULL AUTO_INCREMENT,
  `address` varchar(42) COLLATE utf8mb4_general_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `admins_address` (`address`)
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `chats`
--

DROP TABLE IF EXISTS `chats`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `chats` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tokenAddress` varchar(42) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `replyAddress` varchar(42) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `network` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `comment` text COLLATE utf8mb4_general_ci,
  `code` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `date` datetime DEFAULT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=2617 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=COMPACT;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `followees`
--

DROP TABLE IF EXISTS `followees`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `followees` (
  `id` varchar(42) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `followers` int DEFAULT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=COMPACT;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `followers`
--

DROP TABLE IF EXISTS `followers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `followers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `followerId` varchar(42) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `followeeId` varchar(42) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `followedAt` datetime DEFAULT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `followers_follower_id_followee_id` (`followerId`,`followeeId`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=535 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=COMPACT;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `holders`
--

DROP TABLE IF EXISTS `holders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `holders` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tokenName` varchar(60) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `tokenSymbol` varchar(30) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `tokenAddress` varchar(42) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `holderAddress` varchar(42) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `tokenAmount` decimal(65,18) DEFAULT NULL,
  `network` varchar(25) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `creatorAddress` varchar(42) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `holders_token_address_holder_address` (`tokenAddress`,`holderAddress`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=22561 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=COMPACT;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `indexings`
--

DROP TABLE IF EXISTS `indexings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `indexings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `network` int DEFAULT NULL,
  `block` int DEFAULT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `indexings_network` (`network`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=4750760 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=COMPACT;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `kings`
--

DROP TABLE IF EXISTS `kings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `kings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tokenAddress` varchar(42) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=181 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=COMPACT;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `referral_infos`
--

DROP TABLE IF EXISTS `referral_infos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `referral_infos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `referral_code` varchar(10) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `address` varchar(42) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  `earnings` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=2191 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=COMPACT;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `referrals`
--

DROP TABLE IF EXISTS `referrals`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `referrals` (
  `id` int NOT NULL AUTO_INCREMENT,
  `referrer` varchar(42) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `referee` varchar(42) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  KEY `referrer` (`referrer`) USING BTREE,
  KEY `referee` (`referee`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=210 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=COMPACT;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `requests`
--

DROP TABLE IF EXISTS `requests`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `requests` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `address` varchar(42) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `body` text COLLATE utf8mb4_general_ci,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=1566 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=COMPACT;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tokens`
--

DROP TABLE IF EXISTS `tokens`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tokens` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tokenName` varchar(60) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `tokenSymbol` varchar(30) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `tokenAddress` varchar(44) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `tokenDescription` text COLLATE utf8mb4_general_ci,
  `tokenImage` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `tokenBanner` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `marketcap` decimal(65,18) DEFAULT '0.000000000000000000',
  `price` decimal(65,18) DEFAULT '0.000000000000000000',
  `creatorAddress` varchar(44) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `network` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `replies` int DEFAULT '0',
  `webLink` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `telegramLink` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `twitterLink` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `creationTime` datetime DEFAULT NULL,
  `updateTime` datetime DEFAULT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  `launchedAt` datetime DEFAULT NULL,
  `category` int DEFAULT '0',
  `pairAddress` varchar(42) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `ethPrice` decimal(65,18) DEFAULT '0.000000000000000000',
  `volume` decimal(65,18) DEFAULT NULL,
  `score` decimal(65,18) DEFAULT NULL,
  `virtualEthAmount` decimal(65,18) DEFAULT '0.000000000000000000',
  `virtualTokenAmount` decimal(65,18) DEFAULT '0.000000000000000000',
  `poolType` tinyint DEFAULT '1',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `tokens_token_address` (`tokenAddress`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=1111 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=COMPACT;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `trades`
--

DROP TABLE IF EXISTS `trades`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `trades` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tokenName` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `tokenSymbol` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `tokenAddress` varchar(42) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `tokenImage` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `swapperAddress` varchar(42) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `type` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `ethAmount` decimal(65,18) DEFAULT NULL,
  `tokenAmount` decimal(65,18) DEFAULT NULL,
  `network` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `date` int DEFAULT NULL,
  `txHash` varchar(66) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `tokenPrice` decimal(65,18) DEFAULT '0.000000000000000000',
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  `ethPrice` decimal(65,18) DEFAULT '0.000000000000000000',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `trades_tx_hash` (`txHash`) USING BTREE,
  KEY `trades_ibfk_1` (`tokenAddress`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=64123 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=COMPACT;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `address` varchar(42) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `username` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `avatar` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `bio` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `likes` int DEFAULT '0',
  `creationTime` datetime DEFAULT NULL,
  `updateTime` datetime DEFAULT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  `twitter_id` varchar(64) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `twitter_name` varchar(64) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `twitter_username` varchar(64) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `twitter_access` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `twitter_profile_picture` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `twitter_verified` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`id`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=2207 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=COMPACT;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2025-11-14 18:09:53
