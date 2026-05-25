FROM eclipse-temurin:21-jdk-alpine AS build
WORKDIR /app
COPY App.java ./App.java
RUN javac App.java

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=build /app/ ./
EXPOSE 3000
USER 10001:10001
CMD ["java", "App"]
