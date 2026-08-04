package main

import (
	"fmt"
	"os"
	"syscall"
)

const runcPath = "/usr/bin/buildkit-runc"

func main() {
	args, err := withNoNewKeyring(os.Args[1:])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err := syscall.Exec(runcPath, append([]string{runcPath}, args...), os.Environ()); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func withNoNewKeyring(args []string) ([]string, error) {
	for index, arg := range args {
		if arg != "create" && arg != "run" {
			continue
		}
		result := make([]string, 0, len(args)+2)
		result = append(result, args[:index+1]...)
		result = append(result, "--no-new-keyring", "--no-pivot")
		return append(result, args[index+1:]...), nil
	}
	return args, nil
}
