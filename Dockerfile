FROM composer:2.4 AS composer
WORKDIR /app
COPY src/composer.json .
COPY src/composer.lock .
RUN composer install --no-interaction --no-dev --no-scripts --no-plugins --optimize-autoloader

FROM php:8.1.11-apache AS base
RUN a2enmod rewrite
RUN docker-php-ext-install pdo pdo_mysql
WORKDIR /var/www/html
COPY src/ .
COPY --from=composer /app/vendor/ /var/www/html/vendor/

EXPOSE 80